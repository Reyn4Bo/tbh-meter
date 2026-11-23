// tbh-meter combat plugin — per-hero damage attribution from INSIDE the game (BepInEx 6, IL2CPP).
//
// WHY a plugin: the read-only reader can measure TEAM damage (Σ monster HP drops) but not WHO dealt it —
// the attacker lives only in the transient DamageInfo passed to the damage call (game 1.3.2 experiment:
// read-only attribution failed, held-out R² < 0). This plugin OBSERVES that call; it never changes a value.
//
// HOW: a native detour on Monster.hal(DamageInfo a, bool b) — the public "take damage" entry (Unit vslot
// 56, overridden by Monster). x64 IL2CPP ABI (verified by disassembly, 1.3.2): rcx = this, rdx = DamageInfo*
// (0x30-byte struct passed by pointer), r8b = b, r9 = MethodInfo*. Per hit we read the monster's HP before/
// after the ORIGINAL call → the REAL damage (overkill excluded, the same measure as the reader's team damage)
// and credit it to the attacker. The original is ALWAYS called and the body never throws into the game.
//
// VALIDATED live (1.3.2): over 62s/93s windows the plugin total matched the reader's team damage at
// ratio 1.000; a v0.2 diagnostic that also hooked every UnitHealthController HP mutator (dyt/ble/hym/hiq/
// hip) found ZERO monster damage bypassing Monster.hal, and summon hits arrive with the summoning HERO as
// the attacker — so this single hook is complete.
//
// OUTPUT: every second, %USERPROFILE%\tbh-meter-mod\combat.json — CUMULATIVE counters since the plugin
// loaded (per hero + per non-hero attacker class + total), stamped with the game `pid` so a consumer can
// reject a stale file from an earlier session. Consumers diff two snapshots for a window (the reader does,
// per run). Atomic write (tmp + rename).
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using BepInEx;
using BepInEx.Logging;
using BepInEx.Unity.IL2CPP;
using BepInEx.Unity.IL2CPP.Hook;
using Il2CppInterop.Runtime;

namespace TbhMeterCombat;

/// <summary>Raw field offsets (game 1.3.2 dump). Mirrors reader/config/offsets.py — re-check on a game update.</summary>
internal static class Off
{
    public const int UnitHealthController = 0xB0; // Unit.UnitHealthController (pp)
    public const int HpCurrent = 0x40;            // pp: current HP (float)
    public const int HeroCache = 0x3D8;           // Hero.cache -> xs (HeroRuntime)
    public const int RuntimeInfo = 0x30;          // xs -> HeroInfoData
    public const int HeroKey = 0x30;              // HeroInfoData.HeroKey (int)
    // DamageInfo (struct, offsets inside the struct)
    public const int DiAttacker = 0x00;           // Unit
    public const int DiOriginDamage = 0x08;       // float
    public const int DiIsCritical = 0x0C;         // bool
    public const int DiAttribute = 0x10;          // EDamageAttribute (int)
    public const int DiType = 0x14;               // EDamageType ([Flags] int)
    public const int DiIsRedistributed = 0x28;    // bool
    public const int DiIsBaseAttack = 0x29;       // bool
    public const int DiSource = 0x2C;             // EDamageSource (int)
}

internal sealed class Acc
{
    public double Damage, CritDamage, BaseAttackDamage, RedistributedDamage, OriginDamage;
    public long Hits, Crits;
    public readonly Dictionary<int, double> ByType = new(), ByAttribute = new(), BySource = new();

    public double MaxHit;

    public void Add(double dmg, float origin, bool crit, bool baseAtk, bool redistributed, int type, int attr, int src)
    {
        Damage += dmg; OriginDamage += origin; Hits++;
        if (dmg > MaxHit) MaxHit = dmg;
        if (crit) { Crits++; CritDamage += dmg; }
        if (baseAtk) BaseAttackDamage += dmg;
        if (redistributed) RedistributedDamage += dmg;
        ByType[type] = (ByType.TryGetValue(type, out var a) ? a : 0) + dmg;
        ByAttribute[attr] = (ByAttribute.TryGetValue(attr, out var b) ? b : 0) + dmg;
        BySource[src] = (BySource.TryGetValue(src, out var c) ? c : 0) + dmg;
    }

    public object Snapshot() => new
    {
        damage = Damage, hits = Hits, crits = Crits, crit_damage = CritDamage, base_attack_damage = BaseAttackDamage,
        redistributed_damage = RedistributedDamage, origin_damage = OriginDamage, max_hit = MaxHit,
        by_type = Keyed(ByType), by_attribute = Keyed(ByAttribute), by_source = Keyed(BySource),
    };

    private static Dictionary<string, double> Keyed(Dictionary<int, double> d)
    {
        var o = new Dictionary<string, double>(d.Count);
        foreach (var kv in d) o[kv.Key.ToString()] = kv.Value;
        return o;
    }
}

[BepInPlugin(Guid, "tbh-meter combat", Version)]
public sealed class Plugin : BasePlugin
{
    public const string Guid = "wiki.tbh.meter.combat";
    public const string Version = "0.4.0";   // 0.4: + damage TAKEN per hero (Hero.hal hook), max_hit
    /// <summary>combat.json format version (bump on a breaking shape change; the reader checks it).</summary>
    public const int FormatVersion = 1;
    private const string GameNamespace = "TaskbarHero";

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void HalFn(IntPtr self, IntPtr damageInfo, byte b, IntPtr method);

    private static ManualLogSource _log;
    private static HalFn _original;
    private static HalFn _hook;            // kept alive: the native side holds a pointer to it
    private static INativeDetour _detour;
    // Damage TAKEN: Hero.hal(DamageInfo, bool) — Hero's own override (vslot 56, same x64 ABI as Monster.hal,
    // verified by disassembly 1.3.2). Credited to the VICTIM hero; HP before/after = real loss after mitigation.
    private static HalFn _heroOriginal;
    private static HalFn _heroHook;
    private static INativeDetour _heroDetour;
    private static readonly Dictionary<int, Acc> Taken = new();
    // Re-entrancy guard: a hero whose hal is already on the stack (e.g. redistribution calling back into the
    // same hero) is measured only by the OUTER call — the inner HP change is inside the outer before/after.
    [ThreadStatic] private static List<IntPtr> _heroInProgress;
    private static IntPtr _heroKlass;
    private static readonly object Gate = new();
    private static readonly Dictionary<int, Acc> Heroes = new();
    private static readonly Dictionary<string, Acc> Others = new();
    private static readonly Dictionary<IntPtr, string> KlassName = new();
    private static readonly Acc Total = new();
    private static long _errors;
    private static Timer _writer;
    private static string _outPath;
    private static readonly long StartMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static readonly int Pid = Environment.ProcessId;

    public override void Load()
    {
        _log = Log;
        try
        {
            // Both live in namespace "TaskbarHero" (dump.cs `// Namespace: TaskbarHero`).
            IntPtr monster = FindClass(GameNamespace, "Monster");
            _heroKlass = FindClass(GameNamespace, "Hero");
            IntPtr method = monster == IntPtr.Zero ? IntPtr.Zero : IL2CPP.il2cpp_class_get_method_from_name(monster, "hal", 2);
            if (method == IntPtr.Zero || _heroKlass == IntPtr.Zero)
            {
                _log.LogError($"class/method not found (Monster={monster}, Hero={_heroKlass}, hal={method}) — game updated? plugin idle.");
                return;
            }
            IntPtr fn = Marshal.ReadIntPtr(method); // MethodInfo->methodPointer (first field)
            IntPtr ga = GetModuleHandle("GameAssembly.dll");
            _log.LogInfo($"Monster.hal at GameAssembly+0x{(fn.ToInt64() - ga.ToInt64()):X}");
            _hook = Hal;
            _detour = INativeDetour.CreateAndApply(fn, _hook, out _original);

            IntPtr heroHal = IL2CPP.il2cpp_class_get_method_from_name(_heroKlass, "hal", 2);
            if (heroHal != IntPtr.Zero)
            {
                IntPtr hfn = Marshal.ReadIntPtr(heroHal);
                _log.LogInfo($"Hero.hal at GameAssembly+0x{(hfn.ToInt64() - ga.ToInt64()):X}");
                _heroHook = HeroHal;
                _heroDetour = INativeDetour.CreateAndApply(hfn, _heroHook, out _heroOriginal);
            }
            else _log.LogWarning("Hero.hal not found — damage taken not tracked");

            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "tbh-meter-mod");
            Directory.CreateDirectory(dir);
            _outPath = Path.Combine(dir, "combat.json");
            _writer = new Timer(_ => Write(), null, 1000, 1000);
            _log.LogInfo($"hooked; writing {_outPath} every 1s");
        }
        catch (Exception e)
        {
            _log.LogError($"load failed — plugin idle: {e}");
        }
    }

    [DllImport("kernel32", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string name);

    /// <summary>Class by namespace + name, searched across every loaded IL2CPP image via the raw il2cpp_* API
    /// (independent of interop naming). Zero + a log of the image names when absent.</summary>
    private static unsafe IntPtr FindClass(string ns, string name)
    {
        IntPtr domain = IL2CPP.il2cpp_domain_get();
        uint count = 0;
        IntPtr* assemblies = IL2CPP.il2cpp_domain_get_assemblies(domain, ref count);
        var images = new List<string>();
        for (int i = 0; i < count; i++)
        {
            IntPtr image = IL2CPP.il2cpp_assembly_get_image(assemblies[i]);
            IntPtr klass = IL2CPP.il2cpp_class_from_name(image, ns, name);
            if (klass != IntPtr.Zero) return klass;
            images.Add(Marshal.PtrToStringAnsi(IL2CPP.il2cpp_image_get_name(image)));
        }
        _log.LogWarning($"class {ns}.{name} not in {count} images: {string.Join(", ", images)}");
        return IntPtr.Zero;
    }

    private static unsafe void Hal(IntPtr self, IntPtr di, byte b, IntPtr method)
    {
        float before = -1f;
        IntPtr hc = IntPtr.Zero;
        try
        {
            if (self != IntPtr.Zero)
            {
                hc = *(IntPtr*)(self + Off.UnitHealthController);
                if (hc != IntPtr.Zero) before = *(float*)(hc + Off.HpCurrent);
            }
        }
        catch { Interlocked.Increment(ref _errors); }

        _original(self, di, b, method); // ALWAYS run the game's own code

        try
        {
            if (hc == IntPtr.Zero || before < 0f || di == IntPtr.Zero) return;
            float after = *(float*)(hc + Off.HpCurrent);
            double dmg = before - after;
            if (dmg <= 0) return; // dodge/immune/heal — nothing dealt
            IntPtr attacker = *(IntPtr*)(di + Off.DiAttacker);
            float origin = *(float*)(di + Off.DiOriginDamage);
            bool crit = *(byte*)(di + Off.DiIsCritical) != 0;
            bool redistributed = *(byte*)(di + Off.DiIsRedistributed) != 0;
            bool baseAtk = *(byte*)(di + Off.DiIsBaseAttack) != 0;
            int attr = *(int*)(di + Off.DiAttribute);
            int type = *(int*)(di + Off.DiType);
            int src = *(int*)(di + Off.DiSource);
            lock (Gate)
            {
                Total.Add(dmg, origin, crit, baseAtk, redistributed, type, attr, src);
                Credit(attacker).Add(dmg, origin, crit, baseAtk, redistributed, type, attr, src);
            }
        }
        catch { Interlocked.Increment(ref _errors); }
    }

    private static unsafe int HeroKeyOf(IntPtr hero)
    {
        IntPtr cache = *(IntPtr*)(hero + Off.HeroCache);
        IntPtr info = cache == IntPtr.Zero ? IntPtr.Zero : *(IntPtr*)(cache + Off.RuntimeInfo);
        return info == IntPtr.Zero ? -1 : *(int*)(info + Off.HeroKey);
    }

    private static unsafe void HeroHal(IntPtr self, IntPtr di, byte b, IntPtr method)
    {
        var inProgress = _heroInProgress ??= new List<IntPtr>(4);
        bool outer = self != IntPtr.Zero && !inProgress.Contains(self);
        float before = -1f;
        IntPtr hc = IntPtr.Zero;
        try
        {
            if (outer)
            {
                hc = *(IntPtr*)(self + Off.UnitHealthController);
                if (hc != IntPtr.Zero) before = *(float*)(hc + Off.HpCurrent);
            }
        }
        catch { Interlocked.Increment(ref _errors); }

        if (outer) inProgress.Add(self);
        try { _heroOriginal(self, di, b, method); }   // ALWAYS run the game's own code
        finally { if (outer) inProgress.Remove(self); }

        try
        {
            if (!outer || hc == IntPtr.Zero || before < 0f || di == IntPtr.Zero) return;
            double dmg = before - *(float*)(hc + Off.HpCurrent);
            if (dmg <= 0) return; // dodged/blocked/absorbed/immune
            float origin = *(float*)(di + Off.DiOriginDamage);
            bool crit = *(byte*)(di + Off.DiIsCritical) != 0;
            bool redistributed = *(byte*)(di + Off.DiIsRedistributed) != 0;
            bool baseAtk = *(byte*)(di + Off.DiIsBaseAttack) != 0;
            int attr = *(int*)(di + Off.DiAttribute);
            int type = *(int*)(di + Off.DiType);
            int src = *(int*)(di + Off.DiSource);
            int key = HeroKeyOf(self);
            lock (Gate)
            {
                if (!Taken.TryGetValue(key, out var acc)) Taken[key] = acc = new Acc();
                acc.Add(dmg, origin, crit, baseAtk, redistributed, type, attr, src);
            }
        }
        catch { Interlocked.Increment(ref _errors); }
    }

    /// <summary>The accumulator for this attacker: a Hero → by HeroKey; anything else → by its class name
    /// (none seen live in 1.3.2 — summons attack AS their hero — but kept so nothing is silently dropped).</summary>
    private static unsafe Acc Credit(IntPtr attacker)
    {
        if (attacker == IntPtr.Zero) return Bucket(Others, "<none>");
        IntPtr klass = IL2CPP.il2cpp_object_get_class(attacker);
        if (klass == _heroKlass)
        {
            int key = HeroKeyOf(attacker);
            if (!Heroes.TryGetValue(key, out var acc)) Heroes[key] = acc = new Acc();
            return acc;
        }
        if (!KlassName.TryGetValue(klass, out var name))
        {
            name = Marshal.PtrToStringAnsi(IL2CPP.il2cpp_class_get_name(klass)) ?? "?";
            KlassName[klass] = name;
            _log.LogInfo($"non-hero attacker class seen: {name}");
        }
        return Bucket(Others, name);
    }

    private static Acc Bucket(Dictionary<string, Acc> d, string k)
    {
        if (!d.TryGetValue(k, out var acc)) d[k] = acc = new Acc();
        return acc;
    }

    private static void Write()
    {
        try
        {
            object doc;
            lock (Gate)
            {
                var heroes = new Dictionary<string, object>();
                foreach (var kv in Heroes) heroes[kv.Key.ToString()] = kv.Value.Snapshot();
                var others = new Dictionary<string, object>();
                foreach (var kv in Others) others[kv.Key] = kv.Value.Snapshot();
                var taken = new Dictionary<string, object>();
                foreach (var kv in Taken) taken[kv.Key.ToString()] = kv.Value.Snapshot();
                doc = new
                {
                    v = FormatVersion, plugin = Version, pid = Pid,
                    ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), started = StartMs,
                    errors = Interlocked.Read(ref _errors), total = Total.Snapshot(), heroes, others,
                    taken,   // 0.4: damage TAKEN per victim hero (additive — v stays 1)
                };
            }
            string tmp = _outPath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(doc));
            File.Move(tmp, _outPath, true);
        }
        catch (Exception e)
        {
            _log.LogWarning($"write failed: {e.Message}");
        }
    }
}
