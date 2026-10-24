// =========================================================
// OMNILANG — GAME LAYER (game.js)
// Loaded before app.js. Turns server `progress` snapshots into
// feedback: XP floats, island notifications, level-up sheet,
// sounds, combo meter, activity rings and the daily quest list.
// =========================================================
(function () {
    const store = {
        get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
    };
    const $ = id => document.getElementById(id);
    const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // ---------- Appearance (system / light / dark) ----------
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    function resolvedTheme(pref) { return pref === 'system' ? (media.matches ? 'dark' : 'light') : pref; }
    function setAppearance(pref) {
        if (!['system', 'light', 'dark'].includes(pref)) pref = 'system';
        store.set('omni_appearance', pref);
        document.documentElement.setAttribute('data-theme', resolvedTheme(pref));
        const icon = $('themeToggleBtn')?.querySelector('i');
        if (icon) icon.className = 'fa-solid ' + ({ system: 'fa-circle-half-stroke', light: 'fa-sun', dark: 'fa-moon' }[pref]);
        $('themeToggleBtn')?.setAttribute('title', `Appearance: ${pref[0].toUpperCase() + pref.slice(1)}`);
        document.querySelectorAll('.theme-select-card').forEach(c => c.classList.toggle('selected', c.dataset.thm === pref));
    }
    function getAppearance() { return store.get('omni_appearance', 'system'); }
    function cycleAppearance() {
        const order = ['system', 'light', 'dark'];
        setAppearance(order[(order.indexOf(getAppearance()) + 1) % order.length]);
    }
    media.addEventListener?.('change', () => { if (getAppearance() === 'system') setAppearance('system'); });

    // ---------- Sound (synthesised, no assets) ----------
    let ctx = null;
    const soundOn = () => store.get('omni_sound', 'on') === 'on';
    function tone(freq, start, dur, type = 'sine', gain = 0.12) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime + start);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur + 0.05);
    }
    const SOUNDS = {
        tap:         () => tone(880, 0, 0.05, 'sine', 0.05),
        correct:     () => { tone(784, 0, 0.12); tone(1175, 0.08, 0.22); },
        wrong:       () => { tone(220, 0, 0.18, 'triangle', 0.12); tone(185, 0.09, 0.22, 'triangle', 0.1); },
        xp:          () => { tone(1319, 0, 0.08, 'sine', 0.06); tone(1760, 0.05, 0.12, 'sine', 0.05); },
        quest:       () => [659, 784, 988, 1319].forEach((f, i) => tone(f, i * 0.07, 0.25, 'sine', 0.09)),
        achievement: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.06, 0.35, 'triangle', 0.08)),
        levelup:     () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.3, 'triangle', 0.1)); [1047, 1319, 1568].forEach((f, i) => tone(f, 0.45 + i * 0.02, 0.9, 'sine', 0.06)); },
        combo:       n => tone(660 + Math.min(n, 20) * 40, 0, 0.12, 'square', 0.035)
    };
    function play(name, arg) {
        if (!soundOn() || !SOUNDS[name]) return;
        try {
            ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') ctx.resume();
            SOUNDS[name](arg);
        } catch (_) {}
    }

    // ---------- Pointer tracking for XP floats ----------
    let lastPointer = { x: window.innerWidth / 2, y: 120 };
    document.addEventListener('pointerdown', e => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);
    document.addEventListener('keydown', () => {
        const a = document.activeElement;
        if (a && a !== document.body) {
            const r = a.getBoundingClientRect();
            lastPointer = { x: r.left + r.width / 2, y: r.top };
        }
    }, true);

    function xpFloat(amount, at = lastPointer) {
        if (!amount) return;
        const el = document.createElement('div');
        el.className = 'xp-float';
        el.textContent = `+${amount} XP`;
        el.style.left = Math.min(window.innerWidth - 50, Math.max(50, at.x)) + 'px';
        el.style.top = Math.max(70, at.y - 10) + 'px';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1200);
    }

    // ---------- Island notifications (queued) ----------
    const islandQueue = [];
    let islandBusy = false;
    let islandEl = null;
    function island(opts) { islandQueue.push(opts); if (!islandBusy) nextIsland(); }
    function nextIsland() {
        const o = islandQueue.shift();
        if (!o) { islandBusy = false; return; }
        islandBusy = true;
        if (!islandEl) {
            islandEl = document.createElement('div');
            islandEl.className = 'island';
            islandEl.setAttribute('role', 'status');
            islandEl.setAttribute('aria-live', 'polite');
            document.body.appendChild(islandEl);
        }
        islandEl.innerHTML = `
            <div class="island-icon ${o.iconClass || ''}">${o.icon || '✨'}</div>
            <div class="island-text">
                <div class="island-title">${escH(o.title)}</div>
                ${o.sub ? `<div class="island-sub">${escH(o.sub)}</div>` : ''}
            </div>`;
        if (o.sound) play(o.sound);
        requestAnimationFrame(() => islandEl.classList.add('show'));
        setTimeout(() => {
            islandEl.classList.remove('show');
            setTimeout(nextIsland, 380);
        }, o.duration || 2600);
    }

    // ---------- Level-up sheet ----------
    function showLevelUp(level) {
        const back = document.createElement('div');
        back.className = 'levelup-backdrop';
        back.innerHTML = `
            <div class="levelup-sheet" role="dialog" aria-modal="true" aria-labelledby="luTitle">
                <div class="levelup-badge"><span>${level.level}</span></div>
                <div class="levelup-kicker">Level up!</div>
                <div class="levelup-title" id="luTitle">${escH(level.icon)} ${escH(level.title)}</div>
                <div class="levelup-sub">Du bist jetzt Level ${level.level}. Weiter so — nur noch ${level.xpForNext - level.xpIntoLevel} XP bis Level ${level.level + 1}.</div>
                <button class="btn-primary" type="button">Weiter</button>
            </div>`;
        document.body.appendChild(back);
        play('levelup');
        if (typeof launchConfetti === 'function') launchConfetti();
        requestAnimationFrame(() => back.classList.add('show'));
        const close = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 300); };
        back.querySelector('button').addEventListener('click', close);
        back.addEventListener('click', e => { if (e.target === back) close(); });
        back.querySelector('button').focus();
    }

    // ---------- Player card + rings ----------
    const QUEST_META = {
        vocab:    { title: 'Karteikarten wiederholen', unit: 'Karten',     tile: 'tile-vocab',    icon: 'fa-layer-group',     color: '#ff9f0a' },
        chat:     { title: 'Mit Lukas chatten',        unit: 'Nachrichten', tile: 'tile-chat',     icon: 'fa-comments',        color: '#0a84ff' },
        speaking: { title: 'Laut sprechen',            unit: 'Antworten',  tile: 'tile-speaking', icon: 'fa-microphone-lines', color: '#ff375f' },
        writing:  { title: 'Einen Text schreiben',     unit: 'Text',       tile: 'tile-writing',  icon: 'fa-pen-nib',         color: '#bf5af2' },
        reading:  { title: 'Eine Geschichte lesen',    unit: 'Geschichte', tile: 'tile-reading',  icon: 'fa-book-open',       color: '#30d158' }
    };

    function levelFromXp(xp) {
        // Mirrors src/utils/game.js (server is authoritative; this is for instant UI)
        const need = l => { const n = Math.max(0, l - 1); return 50 * n + 25 * n * n; };
        let level = 1; while (xp >= need(level + 1)) level++;
        const floor = need(level), ceil = need(level + 1);
        const titles = [[30, 'Sprachlegende', '👑'], [20, 'Goethe-Gefährte', '🏛️'], [15, 'Schwarzwald-Gelehrter', '🌲'], [11, 'Grammatik-Meister', '📜'], [8, 'Konversations-Pionier', '🎙️'], [5, 'Satz-Baumeister', '🔨'], [3, 'Wort-Entdecker', '🧭'], [1, 'Sprach-Neuling', '🌱']];
        const t = titles.find(([from]) => level >= from);
        return { level, title: t[1], icon: t[2], xpIntoLevel: xp - floor, xpForNext: ceil - floor, pct: Math.round(((xp - floor) / (ceil - floor)) * 100) };
    }

    function setRing(id, frac) {
        const el = $(id);
        if (!el) return;
        const len = parseFloat(el.getAttribute('stroke-dasharray'));
        el.style.strokeDashoffset = String(len * (1 - Math.max(0, Math.min(1, frac))));
    }

    function greeting() {
        const h = new Date().getHours();
        return h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 17 ? 'Guten Tag' : h < 22 ? 'Guten Abend' : 'Gute Nacht';
    }

    function renderPlayer() {
        if (typeof auth === 'undefined' || !auth) return;
        const lvl = auth.playerLevel && auth.playerLevel.level ? auth.playerLevel : levelFromXp(auth.xp || 0);
        const name = (auth.username || auth.nickname || 'Learner').replace(/^@/, '');
        if ($('homeGreeting')) $('homeGreeting').textContent = `${greeting()}, ${name.split(' ')[0]}!`;
        if ($('playerName')) $('playerName').textContent = name;
        if ($('playerTitle')) $('playerTitle').textContent = `${lvl.icon} ${lvl.title}`;
        if ($('orbAvatar')) $('orbAvatar').textContent = auth.avatar || '🇩🇪';
        if ($('orbLevel')) $('orbLevel').textContent = `Lvl ${lvl.level}`;
        if ($('playerXpFill')) $('playerXpFill').style.width = `${lvl.pct}%`;
        if ($('playerXpLabel')) $('playerXpLabel').textContent = `${lvl.xpIntoLevel} / ${lvl.xpForNext} XP`;
        if ($('playerXpNext')) $('playerXpNext').textContent = `${lvl.xpForNext - lvl.xpIntoLevel} XP bis Level ${lvl.level + 1}`;
        if ($('pstatStreak')) $('pstatStreak').textContent = auth.streak || 0;
        if ($('pstatWords')) $('pstatWords').textContent = auth.totalWordsLearned || 0;
        if ($('pstatFreeze')) $('pstatFreeze').textContent = auth.streakFreezes || 0;
        const orb = $('orbFill');
        if (orb) orb.style.strokeDashoffset = String(339.3 * (1 - lvl.pct / 100));
    }

    function renderDaily(d) {
        if (!d) return;
        const mods = d.modules || {};
        const done = Object.values(mods).filter(m => m.completed).length;
        const total = Object.keys(mods).length || 5;

        if ($('syncDateLabel')) $('syncDateLabel').textContent = d.dateFormatted || 'Heute';
        if ($('dailyCompletionStatus')) $('dailyCompletionStatus').textContent = d.summary?.allDone ? 'Alle erledigt — Bonus kassiert! 🎉' : `${done} / ${total} erledigt · alle 5 = +50 XP`;

        setRing('ringMove', (d.todayXp || 0) / (d.dailyGoalXp || 30));
        setRing('ringQuest', done / total);
        setRing('ringWords', (d.todayMinutes || 0) / (d.dailyGoalMinutes || 15));
        if ($('ringMoveVal')) $('ringMoveVal').innerHTML = `${d.todayXp || 0}<small>/${d.dailyGoalXp || 30} XP</small>`;
        if ($('ringQuestVal')) $('ringQuestVal').innerHTML = `${done}<small>/${total}</small>`;
        if ($('ringWordsVal')) $('ringWordsVal').innerHTML = `${d.todayMinutes || 0}<small>/${d.dailyGoalMinutes || 15} min</small>`;

        const list = $('questList');
        if (!list) return;
        list.innerHTML = Object.entries(QUEST_META).map(([key, q]) => {
            const m = mods[key] || { current: 0, target: 1, completed: false };
            const pct = Math.min(100, Math.round((Math.min(m.current, m.target) / m.target) * 100));
            return `
                <div class="quest-row ${m.completed ? 'done' : ''}" data-quest="${key}" role="button" tabindex="0">
                    <div class="quest-icon ${q.tile}"><i class="fa-solid ${m.completed ? 'fa-check' : q.icon}"></i></div>
                    <div>
                        <div class="quest-title">${q.title}</div>
                        <div class="quest-sub">${Math.min(m.current, m.target)} / ${m.target} ${q.unit}</div>
                        <div class="quest-progress"><div style="width:${pct}%;background:${q.color}"></div></div>
                    </div>
                    <span class="quest-reward">${m.completed ? '✓ +10 XP' : '+10 XP'}</span>
                    <i class="fa-solid fa-chevron-right quest-chevron"></i>
                </div>`;
        }).join('');
        list.querySelectorAll('.quest-row').forEach(row => {
            const open = () => { play('tap'); if (typeof openPanel === 'function') openPanel(row.dataset.quest); };
            row.addEventListener('click', open);
            row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        });
    }

    // ---------- Progress snapshots from the server ----------
    function applyProgress(data, opts = {}) {
        if (!data || typeof auth === 'undefined') return;
        const p = data.progress;
        if (!p) {
            if (data.xpEarned) {
                auth.xp = (auth.xp || 0) + data.xpEarned;
                xpFloat(data.xpEarned, opts.at);
            }
        } else {
            auth.xp = p.xp;
            auth.streak = p.streak;
            auth.streakFreezes = p.streakFreezes;
            auth.playerLevel = p.level;
            auth.totalWordsLearned = p.totalWordsLearned ?? auth.totalWordsLearned;
            if (!opts.quiet) xpFloat(p.xpGained, opts.at);
            if (p.xpGained && !opts.quiet) play('xp');

            const chip = $('navXpChip');
            if (chip) { chip.classList.remove('pulse'); void chip.offsetWidth; chip.classList.add('pulse'); }

            if (p.streakExtended && p.streak > 0) {
                island({ icon: '🔥', title: `${p.streak} ${p.streak === 1 ? 'Tag' : 'Tage'} Streak!`, sub: p.streak === 1 ? 'Komm morgen wieder, um sie zu verlängern' : 'Dein Streak lebt — stark!', sound: 'quest' });
            }
            (p.questsCompleted || []).forEach(q => island({
                icon: '✅', title: 'Quest erfüllt!', sub: `${QUEST_META[q]?.title || q} · +10 XP`, sound: 'quest'
            }));
            if (p.allQuestsDone) {
                island({ icon: '🏆', title: 'Alle Tagesquests geschafft!', sub: '+50 Bonus-XP', sound: 'achievement', duration: 3200 });
                if (typeof launchConfetti === 'function') launchConfetti();
            }
            (p.achievements || []).forEach(a => island({
                icon: a.icon, title: `Abzeichen: ${a.title}`, sub: `${a.description} · +${a.xpReward} XP`, sound: 'achievement', duration: 3200
            }));
            if (p.levelUp) setTimeout(() => showLevelUp(p.level), 400);
        }
        try { localStorage.setItem('tanim_auth', JSON.stringify(auth)); } catch (_) {}
        if (typeof updateNavState === 'function') updateNavState();
        renderPlayer();
        if (typeof loadDailyPracticeStatus === 'function') loadDailyPracticeStatus();
    }

    // ---------- Combo (vocab drills) ----------
    let combo = 0;
    function comboEl() {
        let el = $('comboMeter');
        const stage = $('vocabCardStage');
        if (!el && stage) {
            el = document.createElement('div');
            el.id = 'comboMeter';
            el.className = 'combo-meter';
            stage.parentNode.insertBefore(el, stage);
        }
        return el;
    }
    function renderCombo(bump) {
        const el = comboEl();
        if (!el) return;
        el.className = 'combo-meter' + (combo >= 10 ? ' blazing' : combo >= 3 ? ' hot' : '') + (bump ? ' bump' : '');
        el.innerHTML = combo >= 2
            ? `<span>${combo >= 10 ? '⚡️' : '🔥'}</span><span class="combo-x">Combo ×${combo}</span>${combo >= 5 ? `<span style="font-size:12px;opacity:.8">+${Math.min(3, Math.floor(combo / 5))} Bonus-XP</span>` : ''}`
            : '<span style="font-size:13px;font-weight:500">Richtig in Folge = Combo-Bonus</span>';
    }
    function onCardRated(correct) {
        const wrap = $('fcWrap');
        if (correct) {
            combo++;
            play(combo >= 3 ? 'combo' : 'correct', combo);
            if (combo === 5 || combo === 10 || combo === 20) island({ icon: combo >= 10 ? '⚡️' : '🔥', title: `Combo ×${combo}!`, sub: 'Bonus-XP pro Karte', duration: 1800 });
        } else {
            combo = 0;
            play('wrong');
        }
        if (wrap) { wrap.classList.remove('fc-feedback-correct', 'fc-feedback-wrong'); void wrap.offsetWidth; wrap.classList.add(correct ? 'fc-feedback-correct' : 'fc-feedback-wrong'); }
        renderCombo(correct);
        return combo;
    }

    // ---------- German TTS voice (prefer Premium/Enhanced Siri-quality voices on macOS) ----------
    let bestVoice = null;
    function pickVoice() {
        const voices = window.speechSynthesis?.getVoices() || [];
        const de = voices.filter(v => /^de(-|_|$)/i.test(v.lang));
        const score = v => (/premium/i.test(v.name) ? 40 : 0) + (/enhanced|erweitert/i.test(v.name) ? 30 : 0)
            + (/^(anna|petra|markus|yannick|helena|martin)/i.test(v.name) ? 10 : 0) + (/google/i.test(v.name) ? 8 : 0)
            + (v.lang === 'de-DE' ? 5 : 0) + (v.localService ? 2 : 0);
        bestVoice = de.sort((a, b) => score(b) - score(a))[0] || null;
        return bestVoice;
    }
    if (window.speechSynthesis) {
        pickVoice();
        window.speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
    }

    window.Game = {
        applyProgress, renderDaily, renderPlayer, island, xpFloat, play, showLevelUp,
        onCardRated, renderCombo, resetCombo: () => { combo = 0; renderCombo(false); }, get combo() { return combo; },
        setAppearance, getAppearance, cycleAppearance,
        soundOn, setSound: on => store.set('omni_sound', on ? 'on' : 'off'),
        voice: () => bestVoice || pickVoice()
    };
    window.applyProgress = applyProgress;

    setAppearance(getAppearance());
})();
