"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type UnitKind = "sword" | "bow" | "mage" | "guard";
type Unit = { id: number; kind: UnitKind; level: number };
type Enemy = { id: number; hp: number; maxHp: number; progress: number; kind: "goblin" | "wolf" | "troll" };
type VKUser = { first_name: string; photo_100?: string };
type VKBridge = { send: (method: string, params?: Record<string, unknown>) => Promise<unknown> };

declare global {
  interface Window {
    vkBridge?: VKBridge;
  }
}

const UNIT_DATA: Record<UnitKind, { icon: string; name: string; color: string; power: number }> = {
  sword: { icon: "⚔️", name: "Ратник", color: "#e66f3f", power: 7 },
  bow: { icon: "🏹", name: "Лучник", color: "#4f9c5e", power: 5 },
  mage: { icon: "✨", name: "Волхв", color: "#8266d4", power: 10 },
  guard: { icon: "🛡️", name: "Страж", color: "#3983b8", power: 6 },
};

const INITIAL_UNITS: Array<Unit | null> = [
  { id: 1, kind: "sword", level: 1 },
  { id: 2, kind: "sword", level: 1 },
  { id: 3, kind: "bow", level: 1 },
  null,
  { id: 4, kind: "guard", level: 1 },
  null,
  null,
  null,
  null,
  null,
  null,
  null,
];

const enemyIcon = { goblin: "👺", wolf: "🐺", troll: "👹" };

export default function Home() {
  const [units, setUnits] = useState<Array<Unit | null>>(INITIAL_UNITS);
  const [coins, setCoins] = useState(160);
  const [crystals, setCrystals] = useState(8);
  const [wave, setWave] = useState(1);
  const [castleHp, setCastleHp] = useState(100);
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [selected, setSelected] = useState<number | null>(0);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("Нажми на второго ратника ⚔️");
  const [sound, setSound] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [victory, setVictory] = useState(false);
  const [vkUser, setVkUser] = useState<VKUser | null>(null);
  const nextId = useRef(20);
  const battleTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const bridgeRef = useRef<VKBridge | null>(null);

  const totalPower = useMemo(
    () => units.reduce((sum, unit) => sum + (unit ? UNIT_DATA[unit.kind].power * 2 ** (unit.level - 1) : 0), 0),
    [units],
  );

  useEffect(() => {
    const applySave = (saved: string | null | undefined) => {
      if (!saved) return;
      try {
        const data = JSON.parse(saved);
        if (Array.isArray(data.units)) setUnits(data.units);
        if (typeof data.coins === "number") setCoins(data.coins);
        if (typeof data.wave === "number") setWave(data.wave);
        if (typeof data.castleHp === "number") setCastleHp(data.castleHp);
      } catch {
        localStorage.removeItem("druzhina-save-v1");
      }
    };

    applySave(localStorage.getItem("druzhina-save-v1"));

    const connectVK = async () => {
      if (!window.vkBridge) return;
      bridgeRef.current = window.vkBridge;
      try {
        await window.vkBridge.send("VKWebAppInit");
        await window.vkBridge.send("VKWebAppSetViewSettings", {
          status_bar_style: "light",
          action_bar_color: "#223922",
          navigation_bar_color: "#223922",
        });
        const user = await window.vkBridge.send("VKWebAppGetUserInfo") as VKUser;
        setVkUser(user);
        const storage = await window.vkBridge.send("VKWebAppStorageGet", { keys: ["druzhina_save"] }) as { keys?: Array<{ value: string }> };
        applySave(storage.keys?.[0]?.value);
      } catch {
        bridgeRef.current = null;
      }
    };

    if (window.vkBridge) {
      void connectVK();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@vkontakte/vk-bridge@2.15.0/dist/browser.min.js";
    script.async = true;
    script.onload = () => void connectVK();
    document.head.appendChild(script);
    return () => script.remove();
  }, []);

  useEffect(() => {
    const value = JSON.stringify({ units, coins, wave, castleHp });
    localStorage.setItem("druzhina-save-v1", value);
    if (bridgeRef.current && value.length < 4000) {
      void bridgeRef.current.send("VKWebAppStorageSet", { key: "druzhina_save", value }).catch(() => undefined);
    }
  }, [units, coins, wave, castleHp]);

  const spawnWave = useCallback(() => {
    const amount = Math.min(3 + wave, 9);
    setEnemies(
      Array.from({ length: amount }, (_, index) => {
        const kind = wave % 5 === 0 && index === amount - 1 ? "troll" : index % 3 === 0 ? "wolf" : "goblin";
        const hp = Math.round((kind === "troll" ? 100 : kind === "wolf" ? 42 : 55) * (1 + wave * 0.15));
        return { id: nextId.current++, hp, maxHp: hp, progress: -index * 13, kind };
      }),
    );
    setRunning(true);
    setMessage(`Волна ${wave} наступает!`);
  }, [wave]);

  useEffect(() => {
    if (!running) return;
    battleTimer.current = setInterval(() => {
      setEnemies((current) => {
        if (!current.length) return current;
        const damage = Math.max(1, totalPower * 0.12);
        let hitDone = false;
        const next = current
          .map((enemy) => {
            const inRange = enemy.progress > 13;
            const hp = inRange && !hitDone ? enemy.hp - damage : enemy.hp;
            if (inRange && !hitDone) hitDone = true;
            return { ...enemy, hp, progress: enemy.progress + (enemy.kind === "wolf" ? 2.4 : 1.55) };
          })
          .filter((enemy) => {
            if (enemy.hp <= 0) {
              setCoins((value) => value + (enemy.kind === "troll" ? 55 : 12));
              return false;
            }
            if (enemy.progress >= 93) {
              setCastleHp((hp) => Math.max(0, hp - (enemy.kind === "troll" ? 24 : 9)));
              return false;
            }
            return true;
          });
        return next;
      });
    }, 420);
    return () => {
      if (battleTimer.current) clearInterval(battleTimer.current);
    };
  }, [running, totalPower]);

  useEffect(() => {
    if (!running || enemies.length !== 0) return;
    const timeout = setTimeout(() => {
      setRunning(false);
      if (castleHp <= 0) {
        setMessage("Город пал. Укрепи дружину и попробуй снова.");
      } else if (wave >= 10) {
        setVictory(true);
        setMessage("Все земли спасены!");
      } else {
        setWave((value) => value + 1);
        setMessage("Волна отбита! Усиль дружину.");
      }
    }, 260);
    return () => clearTimeout(timeout);
  }, [castleHp, enemies.length, running, wave]);

  const buyUnit = () => {
    const empty = units.findIndex((unit) => !unit);
    const cost = 35 + Math.floor(wave / 3) * 5;
    if (empty < 0) return setMessage("Нет свободных мест — объедини бойцов");
    if (coins < cost) return setMessage("Не хватает монет");
    const kinds: UnitKind[] = ["sword", "bow", "guard", "mage"];
    const kind = kinds[Math.floor(Math.random() * (wave > 3 ? 4 : 3))];
    setUnits((current) => current.map((unit, index) => (index === empty ? { id: nextId.current++, kind, level: 1 } : unit)));
    setCoins((value) => value - cost);
    setMessage(`${UNIT_DATA[kind].name} вступает в дружину`);
  };

  const chooseCell = (index: number) => {
    if (running) return;
    const target = units[index];
    if (selected === null) {
      if (target) setSelected(index);
      return;
    }
    if (selected === index) return setSelected(null);
    const source = units[selected];
    if (!source) return setSelected(null);

    setUnits((current) => {
      const next = [...current];
      if (!target) {
        next[index] = source;
        next[selected] = null;
        setMessage(`${UNIT_DATA[source.kind].name} перемещён`);
      } else if (target.kind === source.kind && target.level === source.level && target.level < 4) {
        next[index] = { ...target, id: nextId.current++, level: target.level + 1 };
        next[selected] = null;
        setMessage(`${UNIT_DATA[target.kind].name} повышен до ${target.level + 1} уровня!`);
      } else {
        next[index] = source;
        next[selected] = target;
        setMessage("Бойцы поменялись местами");
      }
      return next;
    });
    setSelected(null);
  };

  const mergeTarget = (index: number) => {
    if (selected === null || index === selected || !units[selected] || !units[index]) return false;
    return units[selected]?.kind === units[index]?.kind && units[selected]?.level === units[index]?.level;
  };

  const heal = () => {
    if (crystals < 2 || castleHp >= 100) return;
    setCrystals((value) => value - 2);
    setCastleHp((value) => Math.min(100, value + 25));
    setMessage("Стены города восстановлены");
  };

  const reset = () => {
    setUnits(INITIAL_UNITS);
    setCoins(160);
    setCrystals(8);
    setWave(1);
    setCastleHp(100);
    setEnemies([]);
    setRunning(false);
    setVictory(false);
    setMessage("Новый поход начинается!");
  };

  return (
    <main className="game-shell">
      <div className="sun" />
      <div className="cloud cloud-one" />
      <div className="cloud cloud-two" />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">Д</span>
          <div><strong>ДРУЖИНА</strong><small>ЗАЩИТА ГОРОДА</small></div>
        </div>
        <div className="resources">
          <div className="resource"><span>🪙</span><b>{coins}</b><button aria-label="Купить монеты">+</button></div>
          <div className="resource"><span>💎</span><b>{crystals}</b><button aria-label="Купить кристаллы">+</button></div>
        </div>
        <div className="top-actions">
          {vkUser && (
            <div className="vk-player" title={`Игрок: ${vkUser.first_name}`}>
              {vkUser.photo_100 ? <img src={vkUser.photo_100} alt="" /> : "VK"}
              <span>{vkUser.first_name}</span>
            </div>
          )}
          <button onClick={() => setSound(!sound)} aria-label="Звук">{sound ? "🔊" : "🔇"}</button>
          <button onClick={() => setShowHelp(true)} aria-label="Правила игры">?</button>
        </div>
      </header>

      <section className="battle-card">
        <div className="battle-heading">
          <div>
            <span className="eyebrow">ГЛАВА 1 · БЕРЁЗОВЫЙ ТРАКТ</span>
            <h1>Волна {wave} <span>/ 10</span></h1>
          </div>
          <div className="power"><span>Сила дружины</span><strong>⚡ {Math.round(totalPower)}</strong></div>
        </div>

        <div className="battlefield">
          <div className="far-forest" />
          <div className="road" />
          <div className="castle">
            <div className="flag">◆</div>
            <div className="tower left-tower" />
            <div className="tower right-tower" />
            <div className="gate">⌂</div>
          </div>
          <div className="defenders">
            {units.filter(Boolean).slice(0, 4).map((unit, i) => unit && (
              <span key={unit.id} style={{ left: `${14 + i * 5}%`, animationDelay: `${i * 0.12}s` }}>{UNIT_DATA[unit.kind].icon}</span>
            ))}
          </div>
          {enemies.map((enemy) => (
            <div className="enemy" key={enemy.id} style={{ left: `${enemy.progress}%` }}>
              <div className="enemy-health"><i style={{ width: `${Math.max(0, enemy.hp / enemy.maxHp) * 100}%` }} /></div>
              <span>{enemyIcon[enemy.kind]}</span>
            </div>
          ))}
          {!running && <div className="battle-tip">{message}</div>}
        </div>

        <div className="castle-health">
          <span>🏰 Стены города</span>
          <div className="health-track"><i style={{ width: `${castleHp}%` }} /></div>
          <b>{castleHp}/100</b>
          <button onClick={heal} disabled={crystals < 2 || castleHp >= 100}>+25 · 💎2</button>
        </div>
      </section>

      <section className="camp-card">
        <div className="camp-header">
          <div><span className="eyebrow">БОЕВОЙ ЛАГЕРЬ</span><h2>Собери дружину</h2></div>
          <p className="camp-message">{message}</p>
        </div>
        <div className="tutorial-line">
          <span className="tutorial-number">1</span>
          <b>Объедини бойцов</b>
          <span>Выбери двух одинаковых воинов одного уровня</span>
          <i>→</i>
          <span className="tutorial-number">2</span>
          <b>Нажми «В бой!»</b>
        </div>
        <div className="unit-grid">
          {units.map((unit, index) => (
            <button
              className={`unit-cell ${selected === index ? "selected" : ""} ${mergeTarget(index) ? "merge-target" : ""} ${unit ? "occupied" : ""}`}
              key={index}
              onClick={() => chooseCell(index)}
              aria-label={unit ? `${UNIT_DATA[unit.kind].name}, уровень ${unit.level}` : "Свободное место"}
            >
              {unit ? (
                <>
                  <span className="unit-aura" style={{ background: UNIT_DATA[unit.kind].color }} />
                  <span className="unit-icon">{UNIT_DATA[unit.kind].icon}</span>
                  <span className="level">Ур. {unit.level}</span>
                  <span className="stars">{"★".repeat(unit.level)}</span>
                  {mergeTarget(index) && <span className="tap-here">НАЖМИ</span>}
                </>
              ) : <span className="empty-plus">+</span>}
            </button>
          ))}
        </div>
        <div className="camp-actions">
          <button className="recruit" onClick={buyUnit} disabled={running}>
            <span className="recruit-icon">⚔</span>
            <span><b>Призвать бойца</b><small>Случайный воин</small></span>
            <strong>🪙 {35 + Math.floor(wave / 3) * 5}</strong>
          </button>
          <button className="fight" onClick={castleHp <= 0 ? reset : spawnWave} disabled={running || victory}>
            <span>{castleHp <= 0 ? "НАЧАТЬ ЗАНОВО" : running ? "ИДЁТ БОЙ…" : "В БОЙ!"}</span>
            <small>{castleHp > 0 && !running ? `Награда до ${40 + wave * 12} 🪙` : ""}</small>
          </button>
        </div>
      </section>

      <nav className="bottom-nav" aria-label="Разделы игры">
        <button className="active"><span>⚔️</span>Поход</button>
        <button><span>🏕️</span>Лагерь</button>
        <button><span>📜</span>Задания<i>3</i></button>
        <button><span>🏆</span>Рейтинг</button>
      </nav>

      {(showHelp || victory) && (
        <div className="modal-backdrop" onClick={() => { setShowHelp(false); if (victory) reset(); }}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <span className="modal-icon">{victory ? "🏆" : "🛡️"}</span>
            <h2>{victory ? "Земли спасены!" : "Как играть"}</h2>
            <p>{victory ? "Твоя дружина отбила все десять волн. Новый поход будет сложнее!" : "Нажми на бойца, затем на такого же бойца того же уровня — они объединятся. Собери сильную дружину и отбей 10 волн."}</p>
            <button onClick={() => { setShowHelp(false); if (victory) reset(); }}>{victory ? "Новый поход" : "Понятно"}</button>
          </div>
        </div>
      )}
    </main>
  );
}
