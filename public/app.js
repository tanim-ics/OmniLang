// =========================================================
// OMNILANG — MODERN GERMAN LEARNING COMMAND CENTER (app.js)
// =========================================================

// ---- AUTH & USER STATE ----
let auth = JSON.parse(localStorage.getItem('tanim_auth') || 'null');
if (!auth) {
    // If not logged in, redirect to login.html
    window.location.href = '/login.html';
    throw new Error('Not authenticated');
}

const USER_ID = auth.userId || ('u_' + Math.random().toString(36).slice(2, 10));
let currentLevel = auth.currentLevel || 'A2';
let activeTheme  = auth.theme || localStorage.getItem('tanim_theme') || 'dark-glass';
let ttsEnabled   = true;
let ttsRate      = auth.ttsRate || 0.95;

// Apply initial theme
document.documentElement.setAttribute('data-theme', activeTheme);

// ---- HELPERS ----
function esc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function updateNavState() {
    const levelMap = {
        A1: 'A1 Beginner',
        A2: 'A2 Elementary',
        B1: 'B1 Intermediate',
        B2: 'B2 Upper Int.',
        C1: 'C1 Advanced'
    };
    const levelBadgeCls = {
        A1: 'badge-a1',
        A2: 'badge-a2',
        B1: 'badge-b1',
        B2: 'badge-b2',
        C1: 'badge-c1'
    };

    const levelText = document.getElementById('navLevelText');
    const levelBadge = document.getElementById('navLevelBadge');
    if (levelText) levelText.textContent = levelMap[currentLevel] || currentLevel;
    if (levelBadge) {
        levelBadge.className = `badge-level ${levelBadgeCls[currentLevel] || 'badge-a2'}`;
    }

    // Highlight active level in dropdown
    document.querySelectorAll('.level-option-item').forEach(item => {
        item.classList.toggle('active', item.dataset.lvl === currentLevel);
    });

    const navAvatar = document.getElementById('navAvatar');
    if (navAvatar) navAvatar.textContent = auth.avatar || '🇩🇪';

    const rawNick = (auth.nickname || auth.username || 'Learner').replace(/^@/, '');
    const formattedNick = `@${rawNick}`;

    const navNickname = document.getElementById('navNickname') || document.getElementById('navUsername');
    if (navNickname) navNickname.textContent = formattedNick;

    const dropdownName = document.getElementById('userDropdownName');
    if (dropdownName) dropdownName.textContent = auth.username || rawNick;

    const dropdownHandle = document.getElementById('userDropdownHandle');
    if (dropdownHandle) dropdownHandle.textContent = formattedNick;

    const navStreak = document.getElementById('navStreakCount');
    if (navStreak) navStreak.textContent = `${auth.streak || 1} Day${(auth.streak || 1) !== 1 ? 's' : ''}`;

    const navXp = document.getElementById('navXpCount');
    if (navXp) navXp.textContent = `${auth.xp || 0} XP`;

    const navModel = document.getElementById('navModelName');
    if (navModel) navModel.textContent = auth.selectedModel || 'No model selected';

    const coachTag = document.getElementById('coachLevelTag');
    if (coachTag) coachTag.textContent = currentLevel;

    const chatLevel = document.getElementById('chatLevelIndicator');
    if (chatLevel) chatLevel.textContent = currentLevel;

    // SaaS Admin Portal visibility (Admins & Super Admins only)
    const isAdmin = auth.role === 'admin' || auth.role === 'superadmin';
    const navAdmin = document.getElementById('navAdminChip');
    const dropdownAdmin = document.getElementById('dropdownAdminLink');
    if (navAdmin) {
        navAdmin.style.display = isAdmin ? 'inline-flex' : 'none';
        const label = document.getElementById('navAdminLabel');
        if (label) label.textContent = auth.role === 'superadmin' ? 'Super Admin' : 'Admin Panel';
    }
    if (dropdownAdmin) {
        dropdownAdmin.style.display = isAdmin ? 'flex' : 'none';
    }
}
updateNavState();

// ---- CEFR CONFIGURATION FOR DYNAMIC MODULE ADAPTATION ----
const CEFR_CONFIG = {
    A1: {
        name: 'A1 Beginner',
        badgeCls: 'badge-a1',
        chatGreeting: 'Hallo! Ich bin Lukas, dein Deutschlehrer auf A1-Niveau. 🇩🇪 Wie heißt du und wie geht es dir heute?',
        speakingPrompts: [
            'Hallo! Bitte stelle dich kurz vor: Wie heißt du, woher kommst du und welche Sprachen sprichst du?',
            'Was isst und trinkst du gerne zum Frühstück?',
            'Beschreibe bitte dein Zimmer oder deine Wohnung: Welche Möbel gibt es dort?',
            'Wie ist das Wetter heute bei dir? Scheint die Sonne oder regnet es?',
            'Was kaufst du normalerweise im Supermarkt ein?'
        ],
        essayTemplates: [
            { title: '📅 Mein typischer Tagesablauf', p: 'Beschreibe deinen typischen Tagesablauf auf Deutsch. Was machst du morgens, mittags und abends?' },
            { title: '🏠 Meine Wohnung und mein Zimmer', p: 'Beschreibe deine Wohnung oder dein Zimmer. Welche Möbel hast du und was gefällt dir am besten?' },
            { title: '🍕 Mein Lieblingsessen', p: 'Was isst und trinkst du am liebsten? Wer kocht bei dir zu Hause und was schmeckt dir besonders gut?' }
        ],
        essayPlaceholder: 'Schreibe hier einen einfachen deutschen Text (ca. 30–60 Wörter im Präsens)…\n\nBeispiel: Ich heiße Alex und wohne in Berlin. Jeden Morgen trinke ich Kaffee und esse Brot mit Käse.',
        readingTopics: ['Ein Tag auf dem Wochenmarkt', 'Mein erstes Frühstück im Café', 'Familie Müller macht einen Ausflug', 'Im Zoo von Frankfurt']
    },
    A2: {
        name: 'A2 Elementary',
        badgeCls: 'badge-a2',
        chatGreeting: 'Hallo! Schön dich wiederzusehen. Wie war dein Tag heute? Erzähl mir ein bisschen davon auf Deutsch!',
        speakingPrompts: [
            'Was hast du am vergangenen Wochenende gemacht? Erzähle mir im Perfekt davon.',
            'Wohin bist du in deinem letzten Urlaub gereist und wie bist du dorthin gefahren?',
            'Erzähle von deinem Beruf oder deinem Studium: Was gefällt dir an deiner Arbeit?',
            'Du möchtest eine Party organisieren. Was musst du dafür einkaufen und vorbereiten?',
            'Was machst du normalerweise, wenn du erkältet bist oder Kopfschmerzen hast?'
        ],
        essayTemplates: [
            { title: '🏖️ Mein letztes Wochenende (Perfekt)', p: 'Schreibe über dein letztes Wochenende im Perfekt. Wohin bist du gegangen, mit wem und was hast du erlebt?' },
            { title: '✈️ Eine unvergessliche Urlaubsreise', p: 'Beschreibe deinen letzten Urlaub. Welches Verkehrsmittel hast du genutzt und welche Sehenswürdigkeiten hast du besucht?' },
            { title: '🩺 Mein Besuch beim Arzt', p: 'Schreibe eine kurze Geschichte: Du warst krank. Was hat dir gefehlt und welche Ratschläge hat der Arzt gegeben?' }
        ],
        essayPlaceholder: 'Schreibe hier auf Deutsch (ca. 60–100 Wörter mit Perfekt und Konnektoren wie weil, dass, wenn)…\n\nBeispiel: Letztes Wochenende bin ich mit dem Zug nach Hamburg gefahren. Das Wetter war schön, deshalb haben wir eine Hafenrundfahrt gemacht.',
        readingTopics: ['Eine Zugreise durch die Alpen', 'Der erste Arbeitstag im neuen Büro', 'Wohnungssuche in München', 'Ein gemütlicher Abend im Biergarten']
    },
    B1: {
        name: 'B1 Intermediate',
        badgeCls: 'badge-b1',
        chatGreeting: 'Grüß dich! Willkommen auf B1-Niveau. Über welches interessante Thema oder welche Frage möchtest du heute diskutieren?',
        speakingPrompts: [
            'Warum ist es deiner Meinung nach heutzutage wichtig, eine Fremdsprache wie Deutsch zu beherrschen?',
            'Was sind die Vor- und Nachteile von Homeoffice im Vergleich zum Arbeiten im Büro?',
            'Wie können wir im täglichen Leben die Umwelt und Ressourcen besser schonen?',
            'Welche Rolle spielen soziale Medien in deinem Leben? Nutzen oder Zeitverschwendung?',
            'Sollten öffentliche Verkehrsmittel für alle Bürger kostenlos sein? Begründe deine Ansicht.'
        ],
        essayTemplates: [
            { title: '💻 Online-Lernen vs. Präsenzkurs', p: 'Was sind die Vor- und Nachteile von Online-Unterricht? Schreibe deine persönliche Meinung und begründe sie ausführlich.' },
            { title: '🌍 Umweltschutz im persönlichen Alltag', p: 'Wie kann jeder Einzelne im Alltag zum Klimaschutz beitragen? Welche Maßnahmen hältst du für am wirksamsten?' },
            { title: '📱 Smartphones und moderne Kommunikation', p: 'Wie verändern Smartphones und Messenger-Dienste unsere persönlichen Beziehungen? Nimm fundiert Stellung.' }
        ],
        essayPlaceholder: 'Schreibe hier deinen B1-Aufsatz (ca. 120–180 Wörter mit Argumenten, Beispielen und Nebensätzen)…\n\nBeispiel: Meiner Meinung nach bietet Online-Lernen viele Vorteile, da man zeitlich flexibel ist. Allerdings fehlt oft der persönliche Austausch mit anderen Lernenden.',
        readingTopics: ['Die Energiewende und nachhaltiges Leben', 'Tradition und Wandel im Handwerk', 'Freiwilliges Engagement im Sportverein', 'Leben und Arbeiten in einer Großstadt']
    },
    B2: {
        name: 'B2 Upper Intermediate',
        badgeCls: 'badge-b2',
        chatGreeting: 'Guten Tag! Ich freue mich auf unsere Diskussion auf B2-Niveau. Welches anspruchsvolle gesellschaftliche Thema möchten wir heute analysieren?',
        speakingPrompts: [
            'Inwiefern verändert künstliche Intelligenz die Anforderungen an zukünftige Arbeitnehmer?',
            'Sollten Innenstädte für private Kraftfahrzeuge vollständig gesperrt werden? Wäge die Argumente ab.',
            'Welchen Stellenwert hat lebenslanges Lernen in einer sich rasant wandelnden Arbeitswelt?',
            'Wie beurteilst du die Auswirkungen der Konsumgesellschaft auf unser Wohlbefinden?',
            'Sollte die Vier-Tage-Woche flächendeckend eingeführt werden? Nimm differenziert Stellung.'
        ],
        essayTemplates: [
            { title: '🤖 KI und der Wandel der Arbeitswelt', p: 'Wird künstliche Intelligenz menschliche Arbeitsplätze vernichten oder neue schaffen? Erörtere Chancen und Risiken fundiert.' },
            { title: '🚗 Autofreie Innenstädte', p: 'Sollten Metropolen für privaten Autoverkehr komplett gesperrt werden? Wäge wirtschaftliche und ökologische Argumente gegeneinander ab.' },
            { title: '🎓 Akademische Bildung vs. duale Ausbildung', p: 'Welche Bildungsform bietet jungen Menschen heute nachhaltigere Perspektiven? Begründe deine Position.' }
        ],
        essayPlaceholder: 'Schreibe hier deinen B2-Aufsatz (ca. 180–250 Wörter mit differenzierter Argumentation, Konjunktiv II und Passivkonstruktionen)…',
        readingTopics: ['Strukturwandel: Von der Schwerindustrie zur Technologie', 'Ethische Herausforderungen der Biomedizin', 'Die Zukunft der Mobilität im ländlichen Raum']
    },
    C1: {
        name: 'C1 Advanced',
        badgeCls: 'badge-c1',
        chatGreeting: 'Herzlich willkommen auf C1-Niveau! Welche differenzierte sprachliche oder philosophische Thematik möchten wir heute tiefgründig erörtern?',
        speakingPrompts: [
            'Inwiefern prägt die zunehmende Digitalisierung der Kommunikation unser gesellschaftliches Wertegefüge und demokratische Diskurse?',
            'Welche ethischen Grenzen sollten der genetischen Forschung und Manipulation gesetzt werden?',
            'Analysiere den Zusammenhang zwischen wirtschaftlichem Wachstum und sozialer Gerechtigkeit in postindustriellen Staaten.',
            'Diskutiere die These, dass Sprache nicht nur Wirklichkeit abbildet, sondern gesellschaftliche Realität konstituiert.'
        ],
        essayTemplates: [
            { title: '🏛️ Transformation des Sozialstaates', p: 'Inwiefern erfordert der demografische Wandel eine fundamentale Neuausrichtung des solidarischen Wohlfahrtsstaates? Analysiere Lösungsansätze.' },
            { title: '📰 Medienkompetenz und generative Desinformation', p: 'Analysiere die Bedrohung demokratischer Willensbildung durch algorithmische Filterblasen und Deepfakes.' },
            { title: '🧬 Grenzen des technologischen Fortschritts', p: 'Bedarf der wissenschaftliche Fortschritt strengerer ethischer Regulierung? Erörtere das Spannungsverhältnis zwischen Innovation und Verantwortung.' }
        ],
        essayPlaceholder: 'Verfasse hier eine stilsichere, rhetorisch ausgefeilte C1-Erörterung (ca. 250–350 Wörter)…',
        readingTopics: ['Kulturelle Identität im postglobalen Zeitalter', 'Die Dialektik der Aufklärung in der digitalen Ära', 'Wissenschaftsethik und technologischer Determinismus']
    }
};

let currentSpeakingPromptIndex = 0;

function showLevelToast(text) {
    const toast = document.getElementById('levelToast');
    const toastText = document.getElementById('levelToastText');
    if (!toast || !toastText) return;
    toastText.textContent = text;
    toast.style.display = 'inline-flex';
    clearTimeout(window._levelToastTimeout);
    window._levelToastTimeout = setTimeout(() => {
        toast.style.display = 'none';
    }, 2800);
}

function renderEssayTemplates(lvl) {
    const container = document.getElementById('essayPromptSuggestionsContainer');
    if (!container) return;
    const cfg = CEFR_CONFIG[lvl] || CEFR_CONFIG.A2;
    container.innerHTML = (cfg.essayTemplates || []).map(t => `
        <button class="btn-secondary prompt-template-btn" data-p="${esc(t.p)}" style="text-align:left;font-size:0.8125rem;line-height:1.4;">
            ${esc(t.title)}
        </button>
    `).join('');

    container.querySelectorAll('.prompt-template-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const field = document.getElementById('essayPromptField');
            if (field) field.value = btn.dataset.p;
            document.getElementById('essayTextInput')?.focus();
        });
    });
}

function renderReadingTopics(lvl) {
    const container = document.getElementById('readingTopicChipsContainer');
    if (!container) return;
    const cfg = CEFR_CONFIG[lvl] || CEFR_CONFIG.A2;
    container.innerHTML = (cfg.readingTopics || []).map(topic => `
        <button class="topic-template-chip" data-topic="${esc(topic)}">
            <i class="fa-solid fa-sparkles" style="color:var(--primary);font-size:0.65rem;"></i>
            ${esc(topic)}
        </button>
    `).join('');

    container.querySelectorAll('.topic-template-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const input = document.getElementById('readingTopicInput');
            if (input) input.value = btn.dataset.topic;
            document.getElementById('generateStoryBtn')?.click();
        });
    });
}

// ---- GLOBAL REACTIVE LEVEL DISPATCHER (A1 to C1 across ALL 5 Modules) ----
async function applyGlobalLevelChange(newLevel, notifyUser = true) {
    if (!['A1', 'A2', 'B1', 'B2', 'C1'].includes(newLevel)) return;
    currentLevel = newLevel;
    auth.currentLevel = newLevel;
    localStorage.setItem('tanim_auth', JSON.stringify(auth));
    updateNavState();

    // Close dropdown
    document.getElementById('levelDropdownMenu')?.classList.remove('show');

    const cfg = CEFR_CONFIG[newLevel] || CEFR_CONFIG.A2;

    if (notifyUser) {
        showLevelToast(`✓ Switched to ${cfg.name} — All 5 modules updated`);
        // Notify backend
        fetch('/api/auth/set-level', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: USER_ID, level: newLevel })
        }).catch(() => {});
    }

    // 1. MODULE: VOCABULARY SRS & 15K BANK
    const vocabBadge = document.getElementById('vocabLevelBadge');
    if (vocabBadge) {
        vocabBadge.textContent = `${newLevel} Deck (20 Cards)`;
        vocabBadge.className = `badge-level ${cfg.badgeCls}`;
    }
    vocabLoaded = false;
    // Always reload the 20-card deck with the newly selected CEFR level
    loadVocabDeck(currentVocabMode || 'due');
    // Update bank explorer level pill if A1/A2/B1
    if (['A1', 'A2', 'B1'].includes(newLevel)) {
        document.querySelectorAll('.bank-level-pill').forEach(pill => {
            pill.classList.toggle('active', pill.dataset.lvl === newLevel);
        });
        bankLevel = newLevel;
        if (typeof bankLoaded !== 'undefined' && bankLoaded) {
            loadVocabBank(1);
        }
    }

    // 2. MODULE: AI CONVERSATION (LUKAS)
    const chatLvl = document.getElementById('chatLevelIndicator');
    if (chatLvl) chatLvl.textContent = newLevel;
    const activeChatLvl = document.getElementById('activeChatSessionLevelBadge');
    if (activeChatLvl) {
        activeChatLvl.textContent = newLevel;
        activeChatLvl.className = `badge-mini ${cfg.badgeCls}`;
    }
    if (notifyUser && typeof appendAiMessage === 'function') {
        appendAiMessage(cfg.chatGreeting);
    }

    // 3. MODULE: VOICE IMMERSION SPEAKING
    const spkBadge = document.getElementById('speakingLevelBadge');
    if (spkBadge) {
        spkBadge.textContent = `${newLevel} Speaking`;
        spkBadge.className = `badge-level ${cfg.badgeCls}`;
    }
    const spkTitle = document.getElementById('speakingChallengeTitle');
    if (spkTitle) spkTitle.textContent = `German Speaking Challenge (${newLevel})`;
    currentSpeakingPromptIndex = 0;
    const spkPrompt = document.getElementById('speakingPromptText');
    if (spkPrompt && cfg.speakingPrompts && cfg.speakingPrompts.length) {
        spkPrompt.textContent = cfg.speakingPrompts[0];
    }
    const spkResp = document.getElementById('speakingResponseBox');
    if (spkResp) spkResp.style.display = 'none';
    const spkTrans = document.getElementById('speakingTranscriptBox');
    if (spkTrans) spkTrans.textContent = '';

    // 4. MODULE: WRITING & ESSAY EVALUATOR
    essaySelectedLevel = newLevel;
    const essayBadge = document.getElementById('essayLevelBadge');
    if (essayBadge) {
        essayBadge.textContent = `${newLevel} Writing`;
        essayBadge.className = `badge-level ${cfg.badgeCls}`;
    }
    const essayTag = document.getElementById('essayPromptLevelTag');
    if (essayTag) essayTag.textContent = newLevel;
    // Highlight selector buttons in essay pane
    document.querySelectorAll('#essayLevelSelector .btn-ghost').forEach(b => {
        const isMatch = (b.dataset.level === newLevel);
        b.classList.toggle('active', isMatch);
        b.style.background = isMatch ? 'var(--primary-light)' : '';
        b.style.color = isMatch ? 'var(--primary)' : '';
    });
    renderEssayTemplates(newLevel);
    const essayInput = document.getElementById('essayTextInput');
    if (essayInput) {
        essayInput.placeholder = cfg.essayPlaceholder;
    }

    // 5. MODULE: GRADED READING
    const readBadge = document.getElementById('readingLevelBadge');
    if (readBadge) {
        readBadge.textContent = `${newLevel} Reading`;
        readBadge.className = `badge-level ${cfg.badgeCls}`;
    }
    renderReadingTopics(newLevel);

    // AI Coach and stats
    const coachTag = document.getElementById('coachLevelTag');
    if (coachTag) coachTag.textContent = newLevel;
    loadAiCoachRecommendations();
    loadDailyPracticeStatus();
}

function setUserLevel(newLevel) {
    applyGlobalLevelChange(newLevel, true);
}

document.getElementById('navLevelBadge')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('levelDropdownMenu')?.classList.toggle('show');
});

document.querySelectorAll('.level-option-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.stopPropagation();
        setUserLevel(item.dataset.lvl);
    });
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.level-picker-dropdown-wrap')) {
        document.getElementById('levelDropdownMenu')?.classList.remove('show');
    }
});

// ---- RESET TODAY'S PRACTICE STATUS ----
document.getElementById('resetDailyPracticeBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('resetDailyPracticeBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Resetting...';

    try {
        await fetch('/api/auth/reset-daily-modules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: USER_ID })
        });
        await loadDailyPracticeStatus();
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Reset Done';
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Reset Due Status';
        }, 1500);
    } catch (err) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Reset Due Status';
    }
});

document.getElementById('navModelChip')?.addEventListener('click', () => {
    openPanel('settings');
    setTimeout(() => {
        document.getElementById('settingsModelSelect')?.focus();
    }, 300);
});

// ---- NAVIGATION & VIEW TABS ----
document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const view = btn.dataset.view;

        if (view === 'dashboard') {
            closeAllPanels();
        } else if (view === 'coach') {
            document.getElementById('coachHeroBanner')?.scrollIntoView({ behavior: 'smooth' });
        } else if (view === 'progress') {
            openPanel('progress');
        } else if (view === 'settings') {
            openPanel('settings');
        }
    });
});

// Quick triggers & User Menu Dropdown
const userChip = document.getElementById('navUserChip');
const userDropdown = document.getElementById('userDropdownMenu');

userChip?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!userDropdown) return;
    const isVisible = userDropdown.style.display === 'block';
    userDropdown.style.display = isVisible ? 'none' : 'block';
});

// Close dropdown on click outside
document.addEventListener('click', (e) => {
    if (userDropdown && !userChip?.contains(e.target) && !userDropdown.contains(e.target)) {
        userDropdown.style.display = 'none';
    }
});

document.getElementById('dropdownProfileBtn')?.addEventListener('click', () => {
    if (userDropdown) userDropdown.style.display = 'none';
    openPanel('settings');
});

document.getElementById('dropdownAnalyticsBtn')?.addEventListener('click', () => {
    if (userDropdown) userDropdown.style.display = 'none';
    openPanel('progress');
});

document.getElementById('dropdownLogoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('tanim_auth');
    sessionStorage.clear();
    window.location.href = 'login.html';
});

document.getElementById('settingsQuickBtn')?.addEventListener('click', () => openPanel('settings'));

// Theme toggle
document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
    const themes = ['dark-glass', 'midnight-aurora', 'indigo-glow', 'light-glass'];
    const curIdx = themes.indexOf(activeTheme);
    const nextTheme = themes[(curIdx + 1) % themes.length];
    setTheme(nextTheme);
});

function setTheme(themeName) {
    activeTheme = themeName;
    document.documentElement.setAttribute('data-theme', activeTheme);
    localStorage.setItem('tanim_theme', activeTheme);
    document.querySelectorAll('.theme-select-card').forEach(card => {
        card.classList.toggle('selected', card.dataset.thm === activeTheme);
    });
}

// ---- OVERLAY PANEL CONTROLS ----
function openPanel(id) {
    closeAllPanels();
    const panel = document.getElementById('panel-' + id) || document.getElementById(id);
    if (!panel) return;
    panel.classList.add('open');
    document.body.style.overflow = 'hidden';

    if (id === 'vocab') initVocab();
    if (id === 'chat') initChat();
    if (id === 'progress') loadProgressDashboard();
    if (id === 'settings') loadSettingsModal();
}

function closePanel(panelId) {
    const panel = document.getElementById(panelId.startsWith('panel-') || panelId.startsWith('modal-') ? panelId : 'panel-' + panelId);
    if (panel) panel.classList.remove('open');
    if (!document.querySelector('.module-overlay-panel.open')) {
        document.body.style.overflow = '';
        document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'dashboard'));
    }
}

function closeAllPanels() {
    document.querySelectorAll('.module-overlay-panel').forEach(p => p.classList.remove('open'));
    document.body.style.overflow = '';
}

document.querySelectorAll('[data-open]').forEach(el => {
    el.addEventListener('click', () => openPanel(el.dataset.open));
});
document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => closePanel(el.dataset.close));
});

// =========================================================
// TIME-SYNCED DAILY PRACTICE SCHEDULE & RESET TICKER
// =========================================================
let dailyResetInterval = null;
let secondsUntilDailyReset = 0;

async function loadDailyPracticeStatus() {
    try {
        const r = await fetch(`/api/auth/daily-status/${encodeURIComponent(USER_ID)}`);
        const d = await r.json();
        if (!r.ok) return;

        // 1. Update Date & Time labels
        const dateLabel = document.getElementById('syncDateLabel');
        if (dateLabel) dateLabel.textContent = d.dateFormatted || 'Today';

        const timeLabel = document.getElementById('syncCurrentTime');
        if (timeLabel) timeLabel.textContent = d.timeFormatted || '';

        // 2. Setup ticker for resetsIn
        secondsUntilDailyReset = d.secondsUntilReset || 0;
        updateResetCountdownDisplay();
        if (!dailyResetInterval) {
            dailyResetInterval = setInterval(() => {
                if (secondsUntilDailyReset > 0) {
                    secondsUntilDailyReset--;
                    updateResetCountdownDisplay();
                } else {
                    // Midnight reached: trigger fresh daily reload
                    loadDailyPracticeStatus();
                    loadAiCoachRecommendations();
                }
            }, 1000);
        }

        // 3. Update Overall Completion Bar
        const comp = d.summary || {};
        const compStatus = document.getElementById('dailyCompletionStatus');
        if (compStatus) {
            compStatus.textContent = `${comp.completedCount || 0} / ${comp.total || 5} Completed (${comp.completionPct || 0}%)`;
            if (comp.allDone) compStatus.style.color = 'var(--accent-emerald)';
        }
        const compBar = document.getElementById('dailyCompletionBar');
        if (compBar) compBar.style.width = `${comp.completionPct || 0}%`;

        // 4. Update Daily Chips and Dashboard Card Badges
        const mods = d.modules || {};

        function applyModuleStatus(modKey, chipId, cardBadgeId) {
            const m = mods[modKey];
            if (!m) return;

            const chip = document.getElementById(chipId);
            if (chip) {
                chip.className = `daily-module-chip ${m.completed ? 'completed' : 'due'}`;
                chip.innerHTML = `${m.completed ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-fire"></i>'} <span>${esc(m.name)}: ${m.completed ? 'Done' : 'Due'}</span>`;
            }

            const badge = document.getElementById(cardBadgeId);
            if (badge) {
                badge.className = `module-daily-badge ${m.completed ? 'badge-daily-done' : 'badge-daily-due'}`;
                badge.innerHTML = m.completed
                    ? `<i class="fa-solid fa-circle-check"></i> ${esc(m.badge)}`
                    : `<i class="fa-solid fa-fire"></i> ${esc(m.badge)}`;
            }
        }

        applyModuleStatus('vocab',    'chipDueVocab',    'cardDueBadgeVocab');
        applyModuleStatus('chat',     'chipDueChat',     'cardDueBadgeChat');
        applyModuleStatus('speaking', 'chipDueSpeaking', 'cardDueBadgeSpeaking');
        applyModuleStatus('writing',  'chipDueWriting',  'cardDueBadgeWriting');
        applyModuleStatus('reading',  'chipDueReading',  'cardDueBadgeReading');

    } catch (err) {
        console.warn('Daily status load error:', err.message);
    }
}

function updateResetCountdownDisplay() {
    const hours = Math.floor(secondsUntilDailyReset / 3600);
    const mins  = Math.floor((secondsUntilDailyReset % 3600) / 60);
    const secs  = secondsUntilDailyReset % 60;
    const pad   = n => String(n).padStart(2, '0');
    const countdownEl = document.getElementById('syncResetCountdown');
    if (countdownEl) {
        countdownEl.textContent = `⏳ Resets in ${hours}h ${pad(mins)}m ${pad(secs)}s`;
    }
}

loadDailyPracticeStatus();

// =========================================================
// 1. AI LEARNING COACH INTEGRATION
// =========================================================
async function loadAiCoachRecommendations() {
    const titleEl = document.getElementById('coachFocusTitle');
    const reasonEl = document.getElementById('coachReasoning');
    const missionsEl = document.getElementById('coachMissionsContainer');
    const proverbDe = document.getElementById('proverbDe');
    const proverbEn = document.getElementById('proverbEn');
    const tipText = document.getElementById('coachTipText');

    titleEl.textContent = 'Generating your personalized focus...';
    reasonEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin spin-anim" style="color:var(--primary);"></i> Analyzing your CEFR mastery and database stats...';

    try {
        const res = await fetch(`/api/coach/recommendations?userId=${encodeURIComponent(USER_ID)}`);
        const data = await res.json();
        const rec = data.recommendations || {};

        titleEl.textContent = rec.focusTopic || 'German Practice Focus';
        reasonEl.textContent = rec.reasoning || 'Focus on consistent daily review to reinforce speaking and vocabulary.';

        if (rec.proverb) {
            if (proverbDe) proverbDe.textContent = `"${rec.proverb.german}"`;
            if (proverbEn) proverbEn.textContent = `${rec.proverb.english} (${rec.proverb.literal})`;
        }
        if (rec.coachTip && tipText) {
            tipText.textContent = rec.coachTip;
        }

        // Render missions
        if (rec.missions && missionsEl) {
            missionsEl.innerHTML = rec.missions.map(m => `
                <div class="mission-card" data-module="${esc(m.module)}" data-starter="${esc(m.starter || '')}" data-prompt="${esc(m.prompt || '')}">
                    <div class="mission-info">
                        <div class="mission-icon">
                            <i class="fa-solid ${m.module === 'vocab' ? 'fa-layer-group' : m.module === 'chat' ? 'fa-comments' : m.module === 'writing' ? 'fa-pen-nib' : 'fa-book-open'}"></i>
                        </div>
                        <div>
                            <div class="mission-title">${esc(m.title)}</div>
                            <div style="font-size:0.75rem;color:var(--text-muted);">${esc(m.hint || '')}</div>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:0.6rem;">
                        <span class="mission-xp">+${m.xp || 10} XP</span>
                        <div class="btn-primary" style="padding:0.4rem 0.8rem;font-size:0.75rem;">
                            ${esc(m.actionText || 'Go')} <i class="fa-solid fa-arrow-right"></i>
                        </div>
                    </div>
                </div>
            `).join('');

            missionsEl.querySelectorAll('.mission-card').forEach(card => {
                card.addEventListener('click', () => {
                    const mod = card.dataset.module;
                    if (mod === 'chat') {
                        openPanel('chat');
                        const starter = card.dataset.starter;
                        if (starter) {
                            const chatInput = document.getElementById('chatTextInput');
                            if (chatInput) { chatInput.value = starter; chatInput.focus(); }
                        }
                    } else if (mod === 'writing') {
                        openPanel('writing');
                        const prompt = card.dataset.prompt;
                        if (prompt) {
                            const promptInput = document.getElementById('essayPromptField');
                            if (promptInput) { promptInput.value = prompt; }
                        }
                    } else if (mod === 'vocab') {
                        openPanel('vocab');
                    } else if (mod === 'reading') {
                        openPanel('reading');
                    }
                });
            });
        }

    } catch (err) {
        titleEl.textContent = 'Grammar & Vocabulary Focus';
        reasonEl.textContent = 'Keep practicing with daily conversation, vocabulary spaced repetition, and graded writing.';
    }
}
loadAiCoachRecommendations();

document.getElementById('refreshCoachBtn')?.addEventListener('click', loadAiCoachRecommendations);

// Coach on-demand advice modal
document.getElementById('askCoachModalBtn')?.addEventListener('click', () => {
    openPanel('modal-coach-ask');
});

document.getElementById('sendCoachQuestionBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('coachQuestionInput');
    const question = input.value.trim();
    if (!question) return;

    const btn = document.getElementById('sendCoachQuestionBtn');
    const respBox = document.getElementById('coachAnswerResponse');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin spin-anim"></i> Lukas is thinking...';
    respBox.style.display = 'block';
    respBox.innerHTML = '<div style="color:var(--text-muted);"><i class="fa-solid fa-robot"></i> Consulting your local AI coach...</div>';

    try {
        const r = await fetch('/api/coach/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, userId: USER_ID, level: currentLevel })
        });
        const data = await r.json();
        respBox.innerHTML = `
            <div style="font-weight:700;color:var(--accent-cyan);margin-bottom:0.5rem;"><i class="fa-solid fa-graduation-cap"></i> Coach Lukas Advice:</div>
            <div>${esc(data.advice).replace(/\n/g, '<br>')}</div>
        `;
    } catch (err) {
        respBox.innerHTML = `<div style="color:var(--accent-rose);"><i class="fa-solid fa-triangle-exclamation"></i> Coach consultation failed. Ensure Ollama is running.</div>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Ask Coach';
    }
});

// =========================================================
// 2. VOCABULARY SRS MODULE & REACTION HISTORY LOG
// =========================================================
let vocabQueue = [], vocabIdx = 0, vocabReviewed = 0, vocabLearned = 0, vocabLoaded = false;
let currentVocabMode = 'due'; // 'due' | 'mistakes' | 'all'
let sessionReactions = []; // [{ word, en, rating, stageBefore, stageAfter, time }]
let activeLogTab = 'session'; // 'session' | 'bank'

function initVocab() {
    if (vocabLoaded) return;
    vocabLoaded = true;
    loadVocabDeck('due');
    renderVocabReactionLog();
}

async function loadVocabDeck(mode = 'due') {
    const targetMode = (typeof mode === 'string' && ['due', 'mistakes', 'all'].includes(mode)) ? mode : (currentVocabMode || 'due');
    currentVocabMode = targetMode;
    vocabLoaded = true;
    const stage = document.getElementById('vocabCardStage');
    if (stage) stage.innerHTML = '<div style="text-align:center;padding:3rem;"><i class="fa-solid fa-circle-notch fa-spin spin-anim" style="font-size:2rem;color:var(--primary);"></i></div>';

    // Update Mode Buttons UI
    ['due', 'mistakes', 'all'].forEach(m => {
        const btn = document.getElementById(`vocabMode${m.charAt(0).toUpperCase() + m.slice(1)}Btn`);
        if (btn) btn.classList.toggle('active', m === targetMode);
    });

    const modeHeaders = {
        due: '🔥 Due Flashcards Review',
        mistakes: '🔁 Mistaken Words Drill',
        all: '📚 All Vocabulary Cram Practice'
    };
    const headingEl = document.getElementById('deckModeHeading');
    if (headingEl) headingEl.textContent = modeHeaders[targetMode] || 'Session Progress';

    try {
        const r = await fetch(`/api/vocabulary?userId=${encodeURIComponent(USER_ID)}&level=${encodeURIComponent(currentLevel)}&mode=${targetMode}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);

        vocabQueue = d.words || [];
        vocabIdx = vocabReviewed = vocabLearned = 0;
        const totalInDeck = vocabQueue.length;

        // Update counts in header & stats strip
        const lvlBadge = document.getElementById('vocabLevelBadge');
        if (lvlBadge) lvlBadge.textContent = `${currentLevel} Deck (${totalInDeck} Cards)`;

        const srsDue = document.getElementById('srsStatDue');
        if (srsDue) srsDue.textContent = totalInDeck;
        const statRev = document.getElementById('srsStatReviewed');
        if (statRev) statRev.textContent = '0';
        const statLrn = document.getElementById('srsStatLearned');
        if (statLrn) statLrn.textContent = '0';
        const srsProg = document.getElementById('srsProgressLabel');
        if (srsProg) srsProg.textContent = `0 / ${totalInDeck}`;
        const progFill = document.getElementById('srsProgressFill');
        if (progFill) progFill.style.width = '0%';

        const cardDue = document.getElementById('cardDueBadgeVocab') || document.getElementById('cardDueBadge');
        if (cardDue) cardDue.textContent = `${d.dueCount || totalInDeck} due`;
        const vocabTot = document.getElementById('vocabTotalCount');
        if (vocabTot) vocabTot.textContent = `${d.total || totalInDeck} words`;

        const dueCountEl = document.getElementById('modeDueCount');
        if (dueCountEl) dueCountEl.textContent = d.dueCount || 0;
        const mistakesCountEl = document.getElementById('modeMistakesCount');
        if (mistakesCountEl) mistakesCountEl.textContent = d.mistakesCount || 0;
        const allCountEl = document.getElementById('modeAllCount');
        if (allCountEl) allCountEl.textContent = d.total || totalInDeck;

        const bankCountEl = document.getElementById('bankTotalCount');
        if (bankCountEl) bankCountEl.textContent = d.total || totalInDeck;

        renderVocabCard();
    } catch (err) {
        stage.innerHTML = `<div style="color:var(--accent-rose);text-align:center;padding:2rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message)}</div>`;
    }
}

function renderVocabCard() {
    const stage = document.getElementById('vocabCardStage');
    if (!vocabQueue.length || vocabIdx >= vocabQueue.length) {
        renderDeckComplete();
        return;
    }

    const c = vocabQueue[vocabIdx];
    const srsStageNum = c.srsStage || 1;

    stage.innerHTML = `
        <div class="flashcard-3d-wrap" id="fcWrap">
            <div class="flashcard-3d-inner">
                <div class="card-face-3d card-face-front">
                    <div style="display:flex;justify-content:space-between;width:100%;align-items:center;margin-bottom:1rem;">
                        <span class="badge-level badge-a2">${esc(c.type || 'word')}</span>
                        <div style="display:flex;gap:0.4rem;align-items:center;">
                            ${(c.incorrectCount > 0) ? `<span class="badge-mini" style="background:rgba(239,68,68,0.2);color:var(--accent-rose);"><i class="fa-solid fa-triangle-exclamation"></i> ${c.incorrectCount} mistake${c.incorrectCount !== 1 ? 's' : ''}</span>` : ''}
                            <span class="badge-level badge-b1">Leitner Box ${srsStageNum}/5</span>
                        </div>
                    </div>
                    <div class="fc-word-de">${esc(c.de)}</div>
                    <div style="display:flex;gap:0.75rem;align-items:center;margin-top:0.5rem;">
                        <button class="btn-ghost" id="fcAudioBtn" style="padding:4px 8px;" title="Listen German audio">
                            <i class="fa-solid fa-volume-high"></i> Pronounce
                        </button>
                        <span style="font-size:0.75rem;color:var(--text-muted);"><i class="fa-solid fa-hand-pointer"></i> Click card or press [Space] to flip</span>
                    </div>
                </div>
                <div class="card-face-3d card-face-back">
                    <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;opacity:0.8;margin-bottom:0.4rem;">Translation</div>
                    <div class="fc-word-en">${esc(c.en)}</div>
                    ${c.example ? `<div class="fc-example">"${esc(c.example)}"</div>` : ''}
                    ${c.exampleEn ? `<div class="fc-example-en">${esc(c.exampleEn)}</div>` : ''}
                </div>
            </div>
        </div>

        <div style="margin-top:1.25rem;">
            <div class="srs-action-buttons" id="srsActionRow" style="display:none;">
                <button class="srs-rate-btn srs-rate-again" data-r="again">
                    <span>Again</span>
                    <span class="srs-shortcut-key">[1] Mistake (Box 1)</span>
                </button>
                <button class="srs-rate-btn srs-rate-hard" data-r="hard">
                    <span>Hard</span>
                    <span class="srs-shortcut-key">[2] ~10 min</span>
                </button>
                <button class="srs-rate-btn srs-rate-good" data-r="good">
                    <span>Good</span>
                    <span class="srs-shortcut-key">[3] +3 days (Box ${Math.min(5, srsStageNum + 1)})</span>
                </button>
                <button class="srs-rate-btn srs-rate-easy" data-r="easy">
                    <span>Easy</span>
                    <span class="srs-shortcut-key">[4] +7 days (Mastered)</span>
                </button>
            </div>
            <div id="flipPromptHint" style="text-align:center;font-size:0.8125rem;color:var(--text-muted);font-weight:600;margin-top:0.75rem;">
                <i class="fa-solid fa-rotate"></i> Click card or press [Space] to reveal translation
            </div>
        </div>
    `;

    const wrap = document.getElementById('fcWrap');
    wrap.addEventListener('click', toggleCardFlip);

    document.getElementById('fcAudioBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        speakGerman(c.de);
    });

    document.querySelectorAll('.srs-rate-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            rateCard(btn.dataset.r, c);
        });
    });
}

function toggleCardFlip() {
    const wrap = document.getElementById('fcWrap');
    if (!wrap) return;
    wrap.classList.toggle('flipped');
    const isFlipped = wrap.classList.contains('flipped');
    const actRow = document.getElementById('srsActionRow');
    if (actRow) actRow.style.display = isFlipped ? 'grid' : 'none';
    const hint = document.getElementById('flipPromptHint');
    if (hint) hint.style.display = isFlipped ? 'none' : 'block';
}

// Keyboard shortcuts for flashcards
window.addEventListener('keydown', (e) => {
    const panel = document.getElementById('panel-vocab');
    if (!panel || !panel.classList.contains('open')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space') {
        e.preventDefault();
        toggleCardFlip();
    } else if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
        const wrap = document.getElementById('fcWrap');
        if (wrap && wrap.classList.contains('flipped') && vocabQueue[vocabIdx]) {
            const map = { Digit1: 'again', Digit2: 'hard', Digit3: 'good', Digit4: 'easy' };
            rateCard(map[e.code], vocabQueue[vocabIdx]);
        }
    }
});

async function rateCard(rating, card) {
    document.querySelectorAll('.srs-rate-btn').forEach(b => b.disabled = true);
    let nextStage = card.srsStage || 1;

    try {
        const r = await fetch('/api/vocabulary/rate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: USER_ID, wordId: card.id, rating, source: card.source || 'user' })
        });
        const data = await r.json();
        if (data.srsStage) nextStage = data.srsStage;
        if (data.xpEarned) {
            auth.xp = (auth.xp || 0) + data.xpEarned;
            localStorage.setItem('tanim_auth', JSON.stringify(auth));
            updateNavState();
            loadDailyPracticeStatus();
        }
    } catch (_) {}

    vocabReviewed++;
    if (rating === 'good' || rating === 'easy') vocabLearned++;

    // Record reaction in session history log
    sessionReactions.unshift({
        word: card.de,
        en: card.en,
        type: card.type || 'word',
        rating,
        stageBefore: card.srsStage || 1,
        stageAfter: nextStage,
        example: card.example || '',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    renderVocabReactionLog();

    const statRev = document.getElementById('srsStatReviewed');
    if (statRev) statRev.textContent = vocabReviewed;
    const statLrn = document.getElementById('srsStatLearned');
    if (statLrn) statLrn.textContent = vocabLearned;
    const pct = Math.min(Math.round((vocabReviewed / (vocabQueue.length || 1)) * 100), 100);
    const progFill = document.getElementById('srsProgressFill');
    if (progFill) progFill.style.width = pct + '%';
    const progLbl = document.getElementById('srsProgressLabel');
    if (progLbl) progLbl.textContent = `${vocabReviewed} / ${vocabQueue.length}`;

    vocabIdx++;
    renderVocabCard();
}

function renderDeckComplete() {
    const stage = document.getElementById('vocabCardStage');
    const acc = vocabReviewed ? Math.round((vocabLearned / vocabReviewed) * 100) : 100;
    const mistakeCount = sessionReactions.filter(r => r.rating === 'again' || r.rating === 'hard').length;

    stage.innerHTML = `
        <div class="glass-card" style="padding:2.5rem;text-align:center;max-width:520px;margin:0 auto;box-shadow:0 12px 36px rgba(0,0,0,0.4);">
            <div style="font-size:3rem;margin-bottom:0.75rem;">🎉</div>
            <h3 style="font-size:1.4rem;font-weight:800;color:var(--text-main);margin-bottom:0.4rem;">Deck Complete!</h3>
            <p style="color:var(--text-secondary);font-size:0.9rem;line-height:1.6;margin-bottom:1.5rem;">
                Reviewed <strong>${vocabReviewed}</strong> words &middot; Learned <strong style="color:var(--accent-emerald);">${vocabLearned}</strong> &middot; Accuracy <strong>${acc}%</strong>
            </p>
            <div style="display:flex;flex-direction:column;gap:0.75rem;">
                ${mistakeCount > 0 ? `
                    <button class="btn-primary" id="reviewMistakesBtn" style="justify-content:center;padding:0.85rem;background:linear-gradient(135deg,#e11d48,#be123c);">
                        <i class="fa-solid fa-rotate-left"></i> Re-drill Mistaken Words (${mistakeCount})
                    </button>
                ` : ''}
                <button class="btn-primary" id="generateMoreAiVocabBtn" style="justify-content:center;padding:0.85rem;">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> Generate 20 Fresh Words with Local AI
                </button>
                <button class="btn-secondary" id="restartVocabBtn" style="justify-content:center;padding:0.75rem;">
                    <i class="fa-solid fa-book-open"></i> Review All Existing Words (Cram)
                </button>
            </div>
        </div>
    `;

    document.getElementById('reviewMistakesBtn')?.addEventListener('click', () => {
        loadVocabDeck('mistakes');
    });

    document.getElementById('restartVocabBtn')?.addEventListener('click', () => {
        loadVocabDeck('all');
    });

    document.getElementById('generateMoreAiVocabBtn')?.addEventListener('click', () => {
        generateAiVocabPack();
    });
}

// Render dynamic reaction & review log
async function renderVocabReactionLog() {
    const container = document.getElementById('vocabLogContainer');
    const sessionCountEl = document.getElementById('sessionLogCount');
    if (sessionCountEl) sessionCountEl.textContent = sessionReactions.length;

    if (!container) return;

    if (activeLogTab === 'session') {
        if (!sessionReactions.length) {
            container.innerHTML = `
                <div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.85rem;">
                    <i class="fa-solid fa-clock-rotate-left" style="font-size:1.5rem;margin-bottom:0.5rem;display:block;opacity:0.6;"></i>
                    No cards reviewed yet in this session. Start flipping flashcards to see your live reactions and Leitner Box progress!
                </div>
            `;
            return;
        }

        const ratingBadges = {
            again: '<span class="badge-mini" style="background:rgba(239,68,68,0.2);color:#f87171;font-weight:700;">🔴 Again (Mistake)</span>',
            hard:  '<span class="badge-mini" style="background:rgba(245,158,11,0.2);color:#fbbf24;font-weight:700;">🟡 Hard</span>',
            good:  '<span class="badge-mini" style="background:rgba(16,185,129,0.2);color:#34d399;font-weight:700;">🟢 Good</span>',
            easy:  '<span class="badge-mini" style="background:rgba(56,189,248,0.2);color:#38bdf8;font-weight:700;">⚡ Easy</span>'
        };

        container.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:0.4rem;">
                ${sessionReactions.map((r, i) => `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0.85rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:8px;font-size:0.825rem;flex-wrap:wrap;gap:0.5rem;">
                        <div style="display:flex;align-items:center;gap:0.6rem;">
                            <button class="btn-ghost" onclick="speakGerman('${esc(r.word)}')" style="padding:2px 6px;font-size:0.75rem;" title="Pronounce">
                                <i class="fa-solid fa-volume-high"></i>
                            </button>
                            <div>
                                <span style="font-weight:700;color:var(--text-main);">${esc(r.word)}</span>
                                <span style="color:var(--text-muted);margin-left:0.35rem;">&rarr; ${esc(r.en)}</span>
                            </div>
                        </div>
                        <div style="display:flex;align-items:center;gap:0.5rem;">
                            ${ratingBadges[r.rating] || r.rating}
                            <span class="badge-mini" style="background:rgba(99,102,241,0.15);color:#a5b4fc;">Box ${r.stageBefore} &rarr; ${r.stageAfter}</span>
                            <span style="font-size:0.7rem;color:var(--text-muted);">${r.time}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } else {
        // Bank Tab: Load full user vocabulary bank
        container.innerHTML = '<div style="text-align:center;padding:1.5rem;"><i class="fa-solid fa-circle-notch fa-spin spin-anim" style="font-size:1.5rem;color:var(--primary);"></i></div>';
        try {
            const r = await fetch(`/api/vocabulary/mine?userId=${encodeURIComponent(USER_ID)}`);
            const d = await r.json();
            const words = d.words || [];

            const bankCountEl = document.getElementById('bankTotalCount');
            if (bankCountEl) bankCountEl.textContent = words.length;

            if (!words.length) {
                container.innerHTML = `<div style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.85rem;">No saved words yet. Use AI Words or Reading to add vocabulary!</div>`;
                return;
            }

            container.innerHTML = `
                <div style="display:flex;flex-direction:column;gap:0.4rem;">
                    ${words.map(w => `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0.85rem;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.05);border-radius:8px;font-size:0.825rem;flex-wrap:wrap;gap:0.5rem;">
                            <div style="display:flex;align-items:center;gap:0.6rem;">
                                <button class="btn-ghost" onclick="speakGerman('${esc(w.word)}')" style="padding:2px 6px;font-size:0.75rem;" title="Pronounce">
                                    <i class="fa-solid fa-volume-high"></i>
                                </button>
                                <div>
                                    <span style="font-weight:700;color:var(--text-main);">${esc(w.word)}</span>
                                    <span style="color:var(--text-muted);margin-left:0.35rem;">&rarr; ${esc(w.translation)}</span>
                                </div>
                            </div>
                            <div style="display:flex;align-items:center;gap:0.5rem;">
                                ${(w.incorrectCount > 0) ? `<span class="badge-mini" style="background:rgba(239,68,68,0.2);color:#f87171;">⚠️ ${w.incorrectCount} mistakes</span>` : ''}
                                <span class="badge-mini" style="background:rgba(16,185,129,0.15);color:#34d399;">✓ ${w.correctCount || 0}</span>
                                <span class="badge-mini" style="background:rgba(99,102,241,0.2);color:#a5b4fc;">Leitner Box ${w.srsStage || 1}/5</span>
                                <button class="btn-ghost" onclick="drillSingleWord('${esc(w.word)}', '${esc(w.translation)}', '${esc(w.example || '')}', '${esc(w.sourceText || '')}', ${w.srsStage || 1}, '${w._id}')" style="padding:2px 8px;font-size:0.75rem;" title="Drill this word now">
                                    <i class="fa-solid fa-bullseye"></i> Drill
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch (e) {
            container.innerHTML = `<div style="color:var(--accent-rose);text-align:center;padding:1rem;">Failed to load word bank.</div>`;
        }
    }
}

// Drill a specific single word immediately
window.drillSingleWord = function(de, en, example, exampleEn, srsStage, id) {
    vocabQueue = [{
        id,
        de,
        en,
        type: 'word',
        example,
        exampleEn,
        srsStage: srsStage || 1,
        source: 'user'
    }];
    vocabIdx = 0;
    vocabReviewed = 0;
    vocabLearned = 0;

    const headingEl = document.getElementById('deckModeHeading');
    if (headingEl) headingEl.textContent = `🎯 Focused Drill: "${de}"`;
    const srsDue = document.getElementById('srsStatDue');
    if (srsDue) srsDue.textContent = '1';
    const srsProg = document.getElementById('srsProgressLabel');
    if (srsProg) srsProg.textContent = '0 / 1';

    renderVocabCard();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// Generate 20 fresh words with local AI
async function generateAiVocabPack(customTopic = '') {
    const stage = document.getElementById('vocabCardStage');
    const topic = customTopic || document.getElementById('customVocabTopicInput')?.value.trim() || '';
    const btn = document.getElementById('generateAiVocabBtn');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin spin-anim"></i> Generating 20 Words...';
    }

    stage.innerHTML = `
        <div class="glass-card" style="padding:3rem;text-align:center;max-width:500px;margin:0 auto;box-shadow:0 8px 32px rgba(0,0,0,0.35);">
            <i class="fa-solid fa-brain spin-anim" style="font-size:2.5rem;color:var(--primary);margin-bottom:1rem;"></i>
            <h4 style="font-size:1.15rem;font-weight:800;color:var(--text-main);margin-bottom:0.4rem;">Generating 20 Fresh CEFR ${currentLevel} Words</h4>
            <p style="color:var(--text-secondary);font-size:0.85rem;">Local AI (${auth.selectedModel || 'GPU LLM'}) is crafting a 20-word deck ${topic ? `focused on "${esc(topic)}"` : 'with real-world German expressions'}...</p>
        </div>
    `;

    try {
        const r = await fetch('/api/vocabulary/generate-pack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: USER_ID, level: currentLevel, topic, count: 20 })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);

        // Load generated 20 words directly into active session
        vocabQueue = (data.words && data.words.length) ? data.words : [];
        vocabIdx = vocabReviewed = vocabLearned = 0;

        const headingEl = document.getElementById('deckModeHeading');
        if (headingEl) headingEl.textContent = `✨ AI Pack (${vocabQueue.length} Words): ${data.topic || 'Fresh Practice'}`;
        const srsDue = document.getElementById('srsStatDue');
        if (srsDue) srsDue.textContent = vocabQueue.length;
        const srsProg = document.getElementById('srsProgressLabel');
        if (srsProg) srsProg.textContent = `0 / ${vocabQueue.length}`;

        renderVocabCard();
        renderVocabReactionLog();
    } catch (err) {
        stage.innerHTML = `<div style="color:var(--accent-rose);text-align:center;padding:2rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message)}</div>`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 20 AI Words';
        }
    }
}

// Mode button listeners
document.getElementById('vocabModeDueBtn')?.addEventListener('click', () => loadVocabDeck('due'));
document.getElementById('vocabModeMistakesBtn')?.addEventListener('click', () => loadVocabDeck('mistakes'));
document.getElementById('vocabModeAllBtn')?.addEventListener('click', () => loadVocabDeck('all'));

// Reaction Log tab listeners
document.getElementById('vocabTabSessionBtn')?.addEventListener('click', (e) => {
    activeLogTab = 'session';
    document.getElementById('vocabTabSessionBtn')?.classList.add('active');
    document.getElementById('vocabTabBankBtn')?.classList.remove('active');
    renderVocabReactionLog();
});
document.getElementById('vocabTabBankBtn')?.addEventListener('click', (e) => {
    activeLogTab = 'bank';
    document.getElementById('vocabTabBankBtn')?.classList.add('active');
    document.getElementById('vocabTabSessionBtn')?.classList.remove('active');
    renderVocabReactionLog();
});

document.getElementById('generateAiVocabBtn')?.addEventListener('click', () => {
    generateAiVocabPack();
});

document.getElementById('customVocabTopicInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        generateAiVocabPack();
    }
});

document.getElementById('vocabShuffleBtn')?.addEventListener('click', () => {
    for (let i = vocabQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [vocabQueue[i], vocabQueue[j]] = [vocabQueue[j], vocabQueue[i]];
    }
    vocabIdx = 0;
    renderVocabCard();
});

// =========================================================
// 2B. 15,000-WORD CEFR VOCABULARY BANK EXPLORER
// =========================================================
let bankQuery = '';
let bankLevel = 'all';
let bankTopic = 'All';
let bankPage = 1;
let bankTotalPages = 300;
let bankLoaded = false;
let bankSearchDebounce = null;

// View Toggles
document.getElementById('viewVocabPracticeBtn')?.addEventListener('click', () => {
    document.getElementById('viewVocabPracticeBtn')?.classList.add('active');
    document.getElementById('viewVocabBankBtn')?.classList.remove('active');
    document.getElementById('vocabPracticeStageView').style.display = 'block';
    document.getElementById('vocabBankExplorerView').style.display = 'none';
});

document.getElementById('viewVocabBankBtn')?.addEventListener('click', () => {
    document.getElementById('viewVocabBankBtn')?.classList.add('active');
    document.getElementById('viewVocabPracticeBtn')?.classList.remove('active');
    document.getElementById('vocabPracticeStageView').style.display = 'none';
    document.getElementById('vocabBankExplorerView').style.display = 'block';
    if (!bankLoaded) {
        loadVocabBank(1);
    }
});

async function loadVocabBank(page = 1) {
    bankPage = page;
    const grid = document.getElementById('bankWordGrid');
    if (!grid) return;
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;"><i class="fa-solid fa-circle-notch fa-spin spin-anim" style="font-size:2rem;color:var(--primary);"></i><p style="margin-top:0.75rem;color:var(--text-muted);">Browsing 15,000-word bank...</p></div>';

    try {
        const params = new URLSearchParams({
            page: bankPage,
            limit: 24
        });
        if (bankQuery) params.set('q', bankQuery);
        if (bankLevel && bankLevel !== 'all') params.set('level', bankLevel);
        if (bankTopic && bankTopic !== 'All') params.set('topic', bankTopic);

        const r = await fetch(`/api/vocabulary/bank?${params.toString()}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);

        bankTotalPages = d.totalPages || 1;
        const countEl = document.getElementById('bankResultCount');
        if (countEl) countEl.textContent = (d.total || 0).toLocaleString();
        const pageInd = document.getElementById('bankPageIndicator');
        if (pageInd) pageInd.textContent = `Page ${d.page} of ${bankTotalPages}`;
        const pageLbl = document.getElementById('bankPaginationLabel');
        if (pageLbl) pageLbl.textContent = `Page ${d.page} of ${bankTotalPages}`;

        const prevBtn = document.getElementById('bankPrevPageBtn');
        if (prevBtn) prevBtn.disabled = (d.page <= 1);
        const nextBtn = document.getElementById('bankNextPageBtn');
        if (nextBtn) nextBtn.disabled = (d.page >= bankTotalPages);

        renderBankWords(d.words || []);
        bankLoaded = true;
    } catch (err) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--accent-rose);padding:2rem;">Failed to load vocabulary bank: ${esc(err.message)}</div>`;
    }
}

function renderBankWords(words) {
    const grid = document.getElementById('bankWordGrid');
    if (!grid) return;
    if (!words.length) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-muted);"><i class="fa-solid fa-box-open" style="font-size:2rem;margin-bottom:0.75rem;"></i><p>No matching words found in the 15,000-word dictionary.</p></div>';
        return;
    }

    grid.innerHTML = words.map(w => {
        const lvlCls = w.level === 'A1' ? 'badge-a1' : w.level === 'A2' ? 'badge-a2' : 'badge-b1';
        return `
            <div class="bank-word-card">
                <div>
                    <div class="bank-word-header">
                        <div class="bank-word-de">
                            <span>${esc(w.word)}</span>
                            <button class="btn-ghost play-audio-icon" onclick="speakGerman('${esc(w.word.replace(/^der |^die |^das /i, ''))}')" style="padding:2px 5px;font-size:0.75rem;" title="Listen">
                                <i class="fa-solid fa-volume-high"></i>
                            </button>
                        </div>
                        <div style="display:flex;gap:0.3rem;">
                            <span class="badge-mini ${lvlCls}">${esc(w.level)}</span>
                            <span class="badge-mini" style="background:rgba(255,255,255,0.06);color:var(--text-muted);">${esc(w.type || 'word')}</span>
                        </div>
                    </div>
                    <div class="bank-word-en">${esc(w.translation)}</div>
                    ${w.example ? `
                        <div class="bank-word-example" style="margin-top:0.6rem;">
                            <div>${esc(w.example)}</div>
                            ${w.exampleEn ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.2rem;">${esc(w.exampleEn)}</div>` : ''}
                        </div>
                    ` : ''}
                </div>
                <div class="bank-word-card-footer">
                    <span style="font-size:0.72rem;color:var(--text-muted);"><i class="fa-solid fa-tag"></i> ${esc(w.topic || 'General')}</span>
                    <button class="btn-primary btn-sm add-bank-word-btn" data-id="${w._id}" style="font-size:0.75rem;padding:3px 9px;">
                        <i class="fa-solid fa-plus"></i> Add to SRS
                    </button>
                </div>
            </div>
        `;
    }).join('');

    grid.querySelectorAll('.add-bank-word-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const wordId = btn.dataset.id;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
            try {
                const res = await fetch('/api/vocabulary/bank/add-to-deck', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: USER_ID, wordId })
                });
                const data = await res.json();
                if (data.alreadyExists) {
                    btn.className = 'btn-secondary btn-sm';
                    btn.innerHTML = '<i class="fa-solid fa-check"></i> In Deck';
                } else {
                    btn.className = 'btn-secondary btn-sm';
                    btn.innerHTML = '<i class="fa-solid fa-check"></i> Added!';
                    showLevelToast(`✓ Added "${data.word?.word}" to your SRS deck`);
                    vocabLoaded = false;
                }
            } catch (_) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-plus"></i> Add to SRS';
            }
        });
    });
}

// Level pills in Bank Explorer
document.querySelectorAll('.bank-level-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.bank-level-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        bankLevel = pill.dataset.lvl;
        loadVocabBank(1);
    });
});

// Search input debounce
document.getElementById('bankSearchInput')?.addEventListener('input', (e) => {
    clearTimeout(bankSearchDebounce);
    bankSearchDebounce = setTimeout(() => {
        bankQuery = e.target.value.trim();
        loadVocabBank(1);
    }, 300);
});

// Topic filter
document.getElementById('bankTopicFilter')?.addEventListener('change', (e) => {
    bankTopic = e.target.value;
    loadVocabBank(1);
});

// Pagination
document.getElementById('bankPrevPageBtn')?.addEventListener('click', () => {
    if (bankPage > 1) loadVocabBank(bankPage - 1);
});
document.getElementById('bankNextPageBtn')?.addEventListener('click', () => {
    if (bankPage < bankTotalPages) loadVocabBank(bankPage + 1);
});

// =========================================================
// 3. AI CHAT PARTNER WITH HISTORY SIDEBAR & END CHAT
// =========================================================
let currentChatSessionId = null;
let currentChatSessionData = null;
let chatSessions = [];

function initChat() {
    loadChatSessions();
}

async function loadChatSessions() {
    const list = document.getElementById('chatHistoryList');
    if (!list) return;

    try {
        const r = await fetch(`/api/chat/sessions?userId=${encodeURIComponent(USER_ID)}`);
        const d = await r.json();
        chatSessions = d.sessions || [];

        if (chatSessions.length === 0) {
            list.innerHTML = `
                <div style="text-align:center;padding:2rem 1rem;color:var(--text-muted);font-size:0.8125rem;">
                    <i class="fa-regular fa-comment-dots" style="font-size:1.8rem;margin-bottom:0.6rem;opacity:0.5;"></i>
                    <p>Keine gespeicherten Chats.<br>Klicke auf "New Chat", um zu starten!</p>
                </div>
            `;
            if (!currentChatSessionId) {
                await startNewChatSession(true);
            }
            return;
        }

        renderChatHistoryList();

        // If no session is currently selected, pick the most recent one or start new
        if (!currentChatSessionId) {
            const firstActive = chatSessions.find(s => !s.ended) || chatSessions[0];
            await switchChatSession(firstActive.id);
        }
    } catch (err) {
        list.innerHTML = `<div style="color:var(--accent-rose);padding:1rem;font-size:0.8rem;">Fehler beim Laden: ${esc(err.message)}</div>`;
    }
}

function renderChatHistoryList() {
    const list = document.getElementById('chatHistoryList');
    if (!list) return;

    list.innerHTML = chatSessions.map(s => {
        const isActive = s.id === currentChatSessionId;
        const dateStr = formatChatDate(s.updatedAt || s.createdAt);
        const lvlCls = s.level === 'A1' ? 'badge-a1' : s.level === 'A2' ? 'badge-a2' : 'badge-b1';

        return `
            <div class="chat-history-item ${isActive ? 'active' : ''}" data-id="${s.id}">
                <div class="chat-history-item-top">
                    <span class="chat-history-item-title" title="${esc(s.title)}">${esc(s.title)}</span>
                    <button class="chat-history-delete-btn" data-delete-id="${s.id}" title="Delete session">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
                <div class="chat-history-item-snippet">${esc(s.lastMessageSnippet)}</div>
                <div class="chat-history-item-meta">
                    <div style="display:flex;align-items:center;gap:0.35rem;">
                        <span class="badge-mini ${lvlCls}">${esc(s.level)}</span>
                        ${s.ended ? '<span class="badge-mini" style="background:rgba(255,255,255,0.06);color:var(--text-muted);">Ended</span>' : '<span class="badge-mini" style="background:rgba(16,185,129,0.15);color:#34d399;">Active</span>'}
                    </div>
                    <span>${dateStr}</span>
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('.chat-history-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.chat-history-delete-btn')) return;
            switchChatSession(item.dataset.id);
        });
    });

    list.querySelectorAll('.chat-history-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteChatSession(btn.dataset.deleteId);
        });
    });
}

function formatChatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

async function switchChatSession(sessionId) {
    currentChatSessionId = sessionId;
    const box = document.getElementById('chatMessagesContainer');
    if (box) box.innerHTML = '<div style="text-align:center;padding:3rem;"><i class="fa-solid fa-circle-notch fa-spin spin-anim" style="font-size:2rem;color:var(--primary);"></i></div>';

    // Highlight in list
    document.querySelectorAll('.chat-history-item').forEach(el => {
        el.classList.toggle('active', el.dataset.id === sessionId);
    });

    try {
        const r = await fetch(`/api/chat/session/${sessionId}?userId=${encodeURIComponent(USER_ID)}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);

        const session = d.session;
        currentChatSessionData = session;

        // Update active session bar
        const titleEl = document.getElementById('activeChatSessionTitle');
        if (titleEl) titleEl.textContent = session.title || 'Gespräch mit Lukas';
        const lvlBadge = document.getElementById('activeChatSessionLevelBadge');
        if (lvlBadge) {
            lvlBadge.textContent = session.level || currentLevel;
            lvlBadge.className = `badge-mini badge-${(session.level || 'a2').toLowerCase()}`;
        }
        const statusBadge = document.getElementById('activeChatStatusBadge');
        if (statusBadge) {
            statusBadge.textContent = session.ended ? 'Ended' : 'Active';
            statusBadge.style.background = session.ended ? 'rgba(255,255,255,0.08)' : 'rgba(16,185,129,0.15)';
            statusBadge.style.color = session.ended ? 'var(--text-muted)' : '#34d399';
        }
        const countEl = document.getElementById('activeChatMessageCount');
        if (countEl) countEl.textContent = `${(session.messages || []).length} messages`;

        // Toggle input bar vs ended banner
        const inputBar = document.getElementById('chatInputBar');
        const endedBanner = document.getElementById('chatEndedBanner');
        if (session.ended) {
            if (inputBar) inputBar.style.display = 'none';
            if (endedBanner) endedBanner.style.display = 'flex';
        } else {
            if (inputBar) inputBar.style.display = 'flex';
            if (endedBanner) endedBanner.style.display = 'none';
        }

        // Render messages
        if (box) box.innerHTML = '';
        if (session.messages && session.messages.length > 0) {
            session.messages.forEach(m => {
                if (m.sender === 'user') {
                    appendUserMessage(m.content, false);
                } else {
                    appendAiMessage(m.content, false);
                }
            });
        } else {
            const greeting = CEFR_CONFIG[session.level || currentLevel]?.chatGreeting || 'Hallo! Ich bin Lukas, dein KI-Lehrer. Lass uns auf Deutsch sprechen!';
            appendAiMessage(greeting, false);
        }

        if (box) box.scrollTop = box.scrollHeight;
    } catch (err) {
        if (box) box.innerHTML = `<div style="color:var(--accent-rose);text-align:center;padding:2rem;">Fehler beim Laden des Chats: ${esc(err.message)}</div>`;
    }
}

async function startNewChatSession(promptGreeting = true) {
    try {
        const r = await fetch('/api/chat/new-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: USER_ID, level: currentLevel })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);

        const newSession = d.session;
        currentChatSessionId = newSession.id;
        currentChatSessionData = newSession;

        // Reset UI
        const inputBar = document.getElementById('chatInputBar');
        const endedBanner = document.getElementById('chatEndedBanner');
        if (inputBar) inputBar.style.display = 'flex';
        if (endedBanner) endedBanner.style.display = 'none';

        const titleEl = document.getElementById('activeChatSessionTitle');
        if (titleEl) titleEl.textContent = 'Neues Gespräch';
        const lvlBadge = document.getElementById('activeChatSessionLevelBadge');
        if (lvlBadge) {
            lvlBadge.textContent = currentLevel;
            lvlBadge.className = `badge-mini badge-${currentLevel.toLowerCase()}`;
        }
        const statusBadge = document.getElementById('activeChatStatusBadge');
        if (statusBadge) {
            statusBadge.textContent = 'Active';
            statusBadge.style.background = 'rgba(16,185,129,0.15)';
            statusBadge.style.color = '#34d399';
        }
        const countEl = document.getElementById('activeChatMessageCount');
        if (countEl) countEl.textContent = '0 messages';

        const box = document.getElementById('chatMessagesContainer');
        if (box) box.innerHTML = '';

        if (promptGreeting) {
            const greeting = CEFR_CONFIG[currentLevel]?.chatGreeting || 'Hallo! Ich bin Lukas, dein KI-Lehrer. Lass uns auf Deutsch sprechen!';
            appendAiMessage(greeting, false);
        }

        await loadChatSessions();
        showLevelToast('✓ New conversation started');
        document.getElementById('chatTextInput')?.focus();
    } catch (err) {
        showLevelToast('Could not start new chat: ' + err.message);
    }
}

async function endCurrentChatSession() {
    if (!currentChatSessionId) {
        showLevelToast('No active conversation to end');
        return;
    }

    if (currentChatSessionData && currentChatSessionData.ended) {
        showLevelToast('This conversation is already ended');
        return;
    }

    const endBtn = document.getElementById('endChatBtn');
    if (endBtn) {
        endBtn.disabled = true;
        endBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Ending...';
    }

    try {
        const r = await fetch('/api/chat/end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: currentChatSessionId, userId: USER_ID })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);

        // Update local session state
        if (currentChatSessionData) currentChatSessionData.ended = true;

        // Append Lukas farewell
        if (d.farewell) {
            appendAiMessage(d.farewell);
            if (ttsEnabled) speakGerman(d.farewell.replace(/\[Correction:[\s\S]*?\]/i, '').trim());
        }

        // Render celebratory farewell summary card
        const stats = d.stats || {};
        const cfg = CEFR_CONFIG[stats.level || currentLevel] || CEFR_CONFIG.A2;
        const box = document.getElementById('chatMessagesContainer');
        if (box) {
            const farewellEl = document.createElement('div');
            farewellEl.className = 'chat-farewell-card';
            farewellEl.innerHTML = `
                <div style="font-size:2.2rem;margin-bottom:0.25rem;">🎉 🏁</div>
                <h4 style="font-weight:800;font-size:1.15rem;color:var(--text-main);margin:0;">Gespräch erfolgreich beendet!</h4>
                <p style="color:var(--text-secondary);font-size:0.85rem;margin:0;max-width:440px;">
                    Tolle Leistung! Du hast deine Deutschkenntnisse aktiv angewendet und trainiert.
                </p>
                <div style="display:flex;gap:0.6rem;margin-top:0.6rem;flex-wrap:wrap;justify-content:center;">
                    <span class="badge-mini" style="background:rgba(99,102,241,0.2);color:#a5b4fc;padding:4px 8px;">
                        💬 ${stats.userMessages || 0} Nachrichten
                    </span>
                    <span class="badge-mini" style="background:rgba(16,185,129,0.2);color:#34d399;padding:4px 8px;">
                        ⭐ +${stats.xpEarned || 10} Bonus XP
                    </span>
                    <span class="badge-mini ${cfg.badgeCls}" style="padding:4px 8px;">
                        🎯 Niveau ${stats.level || currentLevel}
                    </span>
                    ${stats.correctionsCount > 0 ? `
                        <span class="badge-mini" style="background:rgba(239,68,68,0.2);color:#f87171;padding:4px 8px;">
                            💡 ${stats.correctionsCount} Korrekturen geübt
                        </span>
                    ` : ''}
                </div>
            `;
            box.appendChild(farewellEl);
            box.scrollTop = box.scrollHeight;
        }

        // Update input bar to ended banner
        const inputBar = document.getElementById('chatInputBar');
        const endedBanner = document.getElementById('chatEndedBanner');
        if (inputBar) inputBar.style.display = 'none';
        if (endedBanner) endedBanner.style.display = 'flex';

        // Update status badge
        const statusBadge = document.getElementById('activeChatStatusBadge');
        if (statusBadge) {
            statusBadge.textContent = 'Ended';
            statusBadge.style.background = 'rgba(255,255,255,0.08)';
            statusBadge.style.color = 'var(--text-muted)';
        }

        // Award XP
        if (stats.xpEarned) {
            auth.xp = (auth.xp || 0) + stats.xpEarned;
            localStorage.setItem('tanim_auth', JSON.stringify(auth));
            updateNavState();
            loadDailyPracticeStatus();
        }

        showLevelToast('✓ Chat ended! +10 XP awarded 🎉');
        await loadChatSessions();

    } catch (err) {
        showLevelToast('Failed to end chat: ' + err.message);
    } finally {
        if (endBtn) {
            endBtn.disabled = false;
            endBtn.innerHTML = '<i class="fa-solid fa-flag-checkered"></i> End Chat';
        }
    }
}

async function deleteChatSession(sessionId) {
    if (!confirm('Diesen Chat wirklich löschen?')) return;
    try {
        const r = await fetch(`/api/chat/session/${sessionId}?userId=${encodeURIComponent(USER_ID)}`, {
            method: 'DELETE'
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);

        showLevelToast('Chat deleted');
        if (currentChatSessionId === sessionId) {
            currentChatSessionId = null;
            currentChatSessionData = null;
            await loadChatSessions();
        } else {
            await loadChatSessions();
        }
    } catch (err) {
        showLevelToast('Could not delete chat: ' + err.message);
    }
}

async function sendChat() {
    const input = document.getElementById('chatTextInput');
    const text = input.value.trim();
    if (!text) return;

    appendUserMessage(text);
    input.value = '';
    const loadingEl = appendChatLoading();

    try {
        const r = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                userId: USER_ID,
                level: currentLevel,
                conversationId: currentChatSessionId
            })
        });
        const data = await r.json();
        loadingEl.remove();
        if (!r.ok) throw new Error(data.error);

        if (data.conversationId) {
            currentChatSessionId = data.conversationId;
            const titleEl = document.getElementById('activeChatSessionTitle');
            if (titleEl && data.title) titleEl.textContent = data.title;
        }

        appendAiMessage(data.reply);
        if (ttsEnabled) speakGerman(data.reply.replace(/\[Correction:[\s\S]*?\]/i, '').trim());

        if (data.xpEarned) {
            auth.xp = (auth.xp || 0) + data.xpEarned;
            localStorage.setItem('tanim_auth', JSON.stringify(auth));
            updateNavState();
            loadDailyPracticeStatus();
        }

        // Silently update sidebar sessions
        loadChatSessions();

    } catch (err) {
        loadingEl.remove();
        appendChatError('Could not reach AI partner. Please verify Ollama is active.');
    }
}

function appendUserMessage(text, scroll = true) {
    const box = document.getElementById('chatMessagesContainer');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'chat-bubble-user';
    el.innerHTML = `
        <div class="chat-avatar-badge user-avatar-badge">${esc(auth.avatar || '🇩🇪')}</div>
        <div class="chat-msg-body">${esc(text)}</div>
    `;
    box.appendChild(el);
    if (scroll) box.scrollTop = box.scrollHeight;
}

function appendAiMessage(raw, scroll = true) {
    const box = document.getElementById('chatMessagesContainer');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'chat-bubble-ai';

    const corrMatch = raw.match(/^\[Correction:\s*([\s\S]*?)\]/i);
    let corrHtml = '', bodyText = raw;

    if (corrMatch) {
        bodyText = raw.replace(/^\[Correction:\s*[\s\S]*?\]/i, '').trim();
        corrHtml = `
            <div class="chat-correction-card">
                <div class="chat-correction-title"><i class="fa-solid fa-circle-exclamation"></i> Grammar Correction</div>
                <div>${esc(corrMatch[1].trim())}</div>
            </div>
        `;
    }

    el.innerHTML = `
        <div class="chat-avatar-badge ai-avatar-badge">AI</div>
        <div style="display:flex;flex-direction:column;gap:0.35rem;max-width:100%;">
            <div class="chat-msg-body">${esc(bodyText)}</div>
            ${corrHtml}
        </div>
    `;
    box.appendChild(el);
    if (scroll) box.scrollTop = box.scrollHeight;
}

function appendChatLoading() {
    const box = document.getElementById('chatMessagesContainer');
    const el = document.createElement('div');
    el.className = 'chat-bubble-ai';
    el.innerHTML = `
        <div class="chat-avatar-badge ai-avatar-badge">AI</div>
        <div class="chat-msg-body" style="color:var(--text-muted);">
            <i class="fa-solid fa-circle-notch fa-spin spin-anim"></i> Lukas denkt nach...
        </div>
    `;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
}

function appendChatError(msg) {
    const box = document.getElementById('chatMessagesContainer');
    if (!box) return;
    const el = document.createElement('div');
    el.style.cssText = 'background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:0.75rem;border-radius:var(--radius-md);text-align:center;font-size:0.8125rem;';
    el.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${esc(msg)}`;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
}

// Event Listeners for Chat
document.getElementById('chatSendBtn')?.addEventListener('click', sendChat);
document.getElementById('chatTextInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

document.getElementById('newChatSessionBtn')?.addEventListener('click', () => startNewChatSession(true));
document.getElementById('startNewChatAfterEndBtn')?.addEventListener('click', () => startNewChatSession(true));
document.getElementById('endChatBtn')?.addEventListener('click', endCurrentChatSession);

document.getElementById('chatSidebarToggleBtn')?.addEventListener('click', () => {
    document.getElementById('chatHistorySidebar')?.classList.toggle('collapsed');
});

document.getElementById('chatClearBtn')?.addEventListener('click', async () => {
    if (!confirm('Möchtest du dieses Gespräch zurücksetzen?')) return;
    if (currentChatSessionId) {
        await deleteChatSession(currentChatSessionId);
    }
});

document.getElementById('chatTtsToggleBtn')?.addEventListener('click', function() {
    ttsEnabled = !ttsEnabled;
    this.innerHTML = ttsEnabled ? '<i class="fa-solid fa-volume-high"></i> Voice ON' : '<i class="fa-solid fa-volume-xmark"></i> Voice OFF';
});

// STT in chat
document.getElementById('chatMicBtn')?.addEventListener('click', function() {
    const btn = this;
    btn.classList.add('recording');
    startSpeechRecognition(
        transcript => {
            document.getElementById('chatTextInput').value = transcript;
            btn.classList.remove('recording');
        },
        () => btn.classList.remove('recording')
    );
});

// =========================================================
// 4. SPEAKING MODE
// =========================================================
let speakingActive = false;
document.getElementById('bigSpeakingMicBtn')?.addEventListener('click', function() {
    if (speakingActive) return;
    speakingActive = true;
    const btn = this;
    btn.style.transform = 'scale(1.1)';
    btn.style.background = 'linear-gradient(135deg, #ef4444 0%, #f97316 100%)';
    document.getElementById('speakingPromptText').textContent = 'Listening... Speak in German now';
    document.getElementById('speakingTranscriptBox').textContent = '';
    document.getElementById('speakingResponseBox').style.display = 'none';

    startSpeechRecognition(
        async transcript => {
            btn.style.transform = '';
            btn.style.background = '';
            document.getElementById('speakingPromptText').textContent = 'Processing your German...';
            document.getElementById('speakingTranscriptBox').textContent = `"${transcript}"`;

            try {
                const r = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: transcript, userId: USER_ID, level: currentLevel })
                });
                const d = await r.json();
                const reply = d.reply || 'Entschuldigung, ich habe das nicht verstanden.';
                const cleanReply = reply.replace(/\[Correction:[\s\S]*?\]/i, '').trim();

                const respBox = document.getElementById('speakingResponseBox');
                respBox.textContent = reply;
                respBox.style.display = 'block';
                document.getElementById('speakingPromptText').textContent = 'Tap the microphone to speak again';

                speakGerman(cleanReply);
            } catch (_) {
                document.getElementById('speakingPromptText').textContent = 'Connection failed. Please retry.';
            }
            speakingActive = false;
        },
        () => {
            btn.style.transform = '';
            btn.style.background = '';
            document.getElementById('speakingPromptText').textContent = 'Microphone access denied or timed out. Try again.';
            speakingActive = false;
        }
    );
});

document.getElementById('nextSpeakingPromptBtn')?.addEventListener('click', () => {
    const cfg = CEFR_CONFIG[currentLevel] || CEFR_CONFIG.A2;
    if (!cfg.speakingPrompts || !cfg.speakingPrompts.length) return;
    currentSpeakingPromptIndex = (currentSpeakingPromptIndex + 1) % cfg.speakingPrompts.length;
    const promptText = cfg.speakingPrompts[currentSpeakingPromptIndex];
    const promptEl = document.getElementById('speakingPromptText');
    if (promptEl) promptEl.textContent = promptText;
    const transBox = document.getElementById('speakingTranscriptBox');
    if (transBox) transBox.textContent = '';
    const respBox = document.getElementById('speakingResponseBox');
    if (respBox) respBox.style.display = 'none';
});

document.getElementById('playSpeakingPromptAudioBtn')?.addEventListener('click', () => {
    const promptText = document.getElementById('speakingPromptText')?.textContent || '';
    if (promptText) speakGerman(promptText);
});

// =========================================================
// 5. ESSAY EVALUATOR
// =========================================================
let essaySelectedLevel = currentLevel;

document.querySelectorAll('#essayLevelSelector .btn-ghost').forEach(b => {
    b.addEventListener('click', () => {
        document.querySelectorAll('#essayLevelSelector .btn-ghost').forEach(x => {
            x.classList.remove('active');
            x.style.background = '';
            x.style.color = '';
        });
        b.classList.add('active');
        b.style.background = 'var(--primary-light)';
        b.style.color = 'var(--primary)';
        essaySelectedLevel = b.dataset.level;
    });
});

document.getElementById('essayTextInput')?.addEventListener('input', () => {
    const text = document.getElementById('essayTextInput').value.trim();
    const count = text ? text.split(/\s+/).filter(Boolean).length : 0;
    document.getElementById('essayWordCountBadge').textContent = `${count} word${count !== 1 ? 's' : ''}`;
});

document.getElementById('essayClearBtn')?.addEventListener('click', () => {
    document.getElementById('essayTextInput').value = '';
    document.getElementById('essayPromptField').value = '';
    document.getElementById('essayWordCountBadge').textContent = '0 words';
});

document.querySelectorAll('.prompt-template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('essayPromptField').value = btn.dataset.p;
        document.getElementById('essayTextInput').focus();
    });
});

document.getElementById('gradeEssaySubmitBtn')?.addEventListener('click', async () => {
    const text = document.getElementById('essayTextInput').value.trim();
    const prompt = document.getElementById('essayPromptField')?.value.trim() || '';
    if (!text) {
        document.getElementById('essayTextInput').focus();
        return;
    }

    const btn = document.getElementById('gradeEssaySubmitBtn');
    const resultsPane = document.getElementById('essayResultsPane');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin spin-anim"></i> Evaluating with Local AI...';
    resultsPane.innerHTML = '<div style="text-align:center;padding:3rem;"><i class="fa-solid fa-circle-notch fa-spin spin-anim" style="font-size:2rem;color:var(--primary);"></i><p style="margin-top:1rem;color:var(--text-muted);">Assessing CEFR grammar rubric & vocabulary...</p></div>';

    try {
        const r = await fetch('/api/essay/grade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, prompt, userId: USER_ID, level: essaySelectedLevel })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);

        renderEssayResults(d);

        if (d.xpEarned) {
            auth.xp = (auth.xp || 0) + d.xpEarned;
            localStorage.setItem('tanim_auth', JSON.stringify(auth));
            updateNavState();
            loadDailyPracticeStatus();
        }
    } catch (err) {
        resultsPane.innerHTML = `<div style="color:var(--accent-rose);text-align:center;padding:2rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message)}</div>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-star"></i> Grade My Essay with AI';
    }
});

function renderEssayResults(d) {
    const pane = document.getElementById('essayResultsPane');
    const scoreCls = d.score >= 80 ? 'score-high' : d.score >= 60 ? 'score-mid' : 'score-low';

    const grammarHtml = (d.grammarErrors || []).map(g => `
        <div class="error-diff-item">
            <div style="font-size:0.75rem;font-weight:700;color:#f87171;text-transform:uppercase;margin-bottom:0.25rem;">
                <i class="fa-solid fa-triangle-exclamation"></i> Grammar Correction
            </div>
            <div class="error-diff-change">
                <del>${esc(g.error)}</del> &rarr; <ins>${esc(g.fix)}</ins>
            </div>
            ${g.rule ? `<div style="font-size:0.8125rem;color:var(--text-secondary);margin-top:0.3rem;">${esc(g.rule)}</div>` : ''}
        </div>
    `).join('');

    const vocabHtml = (d.vocabularyEnhancements || []).map(v => `
        <div class="error-diff-item" style="border-left-color:var(--secondary);background:rgba(139,92,246,0.08);">
            <div style="font-size:0.75rem;font-weight:700;color:#c084fc;text-transform:uppercase;margin-bottom:0.25rem;">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Vocabulary Upgrade
            </div>
            <div class="error-diff-change">
                <del style="color:#c084fc;">${esc(v.overusedWord)}</del> &rarr; <ins style="color:#a855f7;">${esc(v.betterAlternative)}</ins>
            </div>
        </div>
    `).join('');

    pane.innerHTML = `
        <div class="score-hero-card">
            <div class="score-circle-dial ${scoreCls}">${d.score}</div>
            <div>
                <span class="badge-level badge-b1">${esc(d.cefrGrade)} Evaluated</span>
                <h4 style="font-size:1.15rem;font-weight:800;color:var(--text-main);margin:0.25rem 0;">Score: ${d.score}/100</h4>
                <span style="font-size:0.8125rem;color:var(--accent-amber);font-weight:700;"><i class="fa-solid fa-bolt"></i> +${d.xpEarned || 15} XP Earned</span>
            </div>
        </div>

        ${d.overall ? `
            <div style="background:var(--primary-light);border:1px solid var(--border-glass-glow);border-radius:var(--radius-md);padding:1rem;">
                <div style="font-size:0.75rem;font-weight:700;color:var(--primary);text-transform:uppercase;margin-bottom:0.25rem;">
                    <i class="fa-solid fa-comment-dots"></i> Examiner Feedback
                </div>
                <div style="font-size:0.875rem;line-height:1.6;color:var(--text-main);">${esc(d.overall)}</div>
            </div>
        ` : ''}

        <div>
            <label style="font-size:0.75rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:0.5rem;display:block;">
                Detailed Feedback (${(d.grammarErrors || []).length + (d.vocabularyEnhancements || []).length} items)
            </label>
            <div style="display:flex;flex-direction:column;gap:0.65rem;">
                ${grammarHtml || ''}
                ${vocabHtml || ''}
                ${!grammarHtml && !vocabHtml ? '<div style="color:var(--accent-emerald);font-size:0.875rem;"><i class="fa-solid fa-circle-check"></i> Ausgezeichnet! No grammar or vocabulary mistakes found.</div>' : ''}
            </div>
        </div>
    `;
}

// =========================================================
// 6. GRADED READING & WORD MINING
// =========================================================
let currentMiningWord = '', currentMiningWordSpan = null;

document.getElementById('generateStoryBtn')?.addEventListener('click', async () => {
    const topic = document.getElementById('readingTopicInput')?.value.trim() || '';
    const btn = document.getElementById('generateStoryBtn');
    const body = document.getElementById('storyContentBody');

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin spin-anim"></i> Generating...';
    body.innerHTML = '<div style="text-align:center;padding:3rem;"><i class="fa-solid fa-circle-notch fa-spin spin-anim" style="font-size:2rem;color:var(--primary);"></i><p style="margin-top:1rem;color:var(--text-muted);">Crafting a CEFR-aligned German story...</p></div>';

    try {
        const r = await fetch('/api/reading/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: USER_ID, level: currentLevel, topic })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);

        renderClickableStory(d.story);
        if (d.xpEarned) {
            auth.xp = (auth.xp || 0) + d.xpEarned;
            localStorage.setItem('tanim_auth', JSON.stringify(auth));
            updateNavState();
            loadDailyPracticeStatus();
        }
    } catch (err) {
        body.innerHTML = `<div style="color:var(--accent-rose);text-align:center;padding:2rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message)}</div>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Story';
    }
});

function renderClickableStory(text) {
    const body = document.getElementById('storyContentBody');
    const tokens = text.split(/(\s+)/);

    const html = tokens.map(t => {
        if (/^\s+$/.test(t)) return t;
        const clean = t.replace(/^[\u201C\u201D\u201E\u00BB\u00AB"'(]+|[\u201C\u201D\u201E\u00BB\u00AB"'),;:.!?]+$/g, '');
        if (!clean || /^\d+$/.test(clean)) return esc(t);

        const idx = t.indexOf(clean);
        const pre = esc(t.slice(0, idx));
        const post = esc(t.slice(idx + clean.length));
        return `${pre}<span class="story-clickable-word" data-word="${esc(clean)}">${esc(clean)}</span>${post}`;
    }).join('');

    body.innerHTML = `<p>${html}</p>`;

    body.querySelectorAll('.story-clickable-word').forEach(span => {
        span.addEventListener('click', e => handleStoryWordClick(span, e));
    });
}

async function handleStoryWordClick(span, e) {
    currentMiningWord = span.dataset.word;
    currentMiningWordSpan = span;

    const tooltip = document.getElementById('wordMiningTooltip');
    document.getElementById('tooltipDeWord').textContent = currentMiningWord;
    document.getElementById('tooltipEnTrans').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin spin-anim"></i>';
    document.getElementById('tooltipWordType').textContent = 'translating...';
    document.getElementById('tooltipExample').textContent = '';

    const panelRect = document.getElementById('panel-reading').getBoundingClientRect();
    let left = e.clientX - panelRect.left;
    let top = e.clientY - panelRect.top + 20;
    if (left + 300 > panelRect.width) left = panelRect.width - 310;
    if (left < 10) left = 10;

    tooltip.style.left = left + 'px';
    tooltip.style.top  = top + 'px';
    tooltip.style.display = 'block';

    try {
        const r = await fetch('/api/reading/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word: currentMiningWord, context: '', userId: USER_ID })
        });
        const d = await r.json();
        document.getElementById('tooltipEnTrans').textContent = d.translation || currentMiningWord;
        document.getElementById('tooltipWordType').textContent = d.type || 'word';
        document.getElementById('tooltipExample').textContent = d.example ? `"${d.example}"` : '';
    } catch (_) {
        document.getElementById('tooltipEnTrans').textContent = 'Translation unavailable';
    }
}

document.getElementById('closeTooltipBtn')?.addEventListener('click', () => {
    document.getElementById('wordMiningTooltip').style.display = 'none';
});

document.getElementById('addWordToSrsBtn')?.addEventListener('click', async () => {
    if (!currentMiningWord) return;
    const btn = document.getElementById('addWordToSrsBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin spin-anim"></i> Adding to deck...';

    try {
        await fetch('/api/vocabulary/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: USER_ID,
                word: currentMiningWord,
                translation: document.getElementById('tooltipEnTrans').textContent,
                example: document.getElementById('tooltipExample').textContent,
                level: currentLevel,
                addedFrom: 'reading'
            })
        });

        if (currentMiningWordSpan) currentMiningWordSpan.classList.add('mined');
        document.getElementById('wordMiningTooltip').style.display = 'none';
        auth.xp = (auth.xp || 0) + 2;
        localStorage.setItem('tanim_auth', JSON.stringify(auth));
        updateNavState();
        vocabLoaded = false;
    } catch (_) {
        btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Failed';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-plus"></i> Add to Vocabulary Deck';
    }
});

// =========================================================
// 7. PROGRESS TRACKER & GAMIFIED ANALYTICS DASHBOARD
// =========================================================

// Learner Rank progression based on XP
function getLearnerRank(xp = 0) {
    const ranks = [
        { level: 1, title: 'Sprach-Neuling', minXp: 0, maxXp: 100, icon: '🌱', tier: 'bronze' },
        { level: 2, title: 'Wort-Entdecker', minXp: 100, maxXp: 250, icon: '🧭', tier: 'bronze' },
        { level: 3, title: 'Satz-Baumeister', minXp: 250, maxXp: 500, icon: '🔨', tier: 'silver' },
        { level: 4, title: 'Konversations-Pionier', minXp: 500, maxXp: 1000, icon: '🎙️', tier: 'silver' },
        { level: 5, title: 'Grammatik-Meister', minXp: 1000, maxXp: 2000, icon: '📜', tier: 'gold' },
        { level: 6, title: 'Schwarzwald-Gelehrter', minXp: 2000, maxXp: 3500, icon: '🌲', tier: 'gold' },
        { level: 7, title: 'Goethe-Gefährte', minXp: 3500, maxXp: 5000, icon: '🏛️', tier: 'diamond' },
        { level: 8, title: 'Die Sprachlegende', minXp: 5000, maxXp: 10000, icon: '👑', tier: 'diamond' }
    ];
    for (let i = ranks.length - 1; i >= 0; i--) {
        if (xp >= ranks[i].minXp) {
            const r = ranks[i];
            const span = r.maxXp - r.minXp;
            const currentInLevel = xp - r.minXp;
            const pct = Math.min(100, Math.max(5, Math.floor((currentInLevel / span) * 100)));
            const nextXp = Math.max(0, r.maxXp - xp);
            return { ...r, pct, nextXp };
        }
    }
    return { level: 1, title: 'Sprach-Neuling', minXp: 0, maxXp: 100, icon: '🌱', tier: 'bronze', pct: 5, nextXp: 100 };
}

// Celebration Confetti Burst
let confettiAnimId = null;
function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = 'block';

    const colors = ['#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#fbbf24', '#06b6d4'];
    const pieces = Array.from({ length: 80 }, () => ({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * 50,
        r: 5 + Math.random() * 6,
        d: Math.random() * 80,
        color: colors[Math.floor(Math.random() * colors.length)],
        tilt: Math.floor(Math.random() * 10) - 10,
        tiltAngleInc: (Math.random() * 0.07) + 0.05,
        tiltAngle: 0,
        speed: 2 + Math.random() * 4
    }));

    if (confettiAnimId) cancelAnimationFrame(confettiAnimId);

    const startTime = Date.now();
    function render() {
        const elapsed = Date.now() - startTime;
        if (elapsed > 2800) {
            canvas.style.display = 'none';
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(p => {
            p.tiltAngle += p.tiltAngleInc;
            p.y += (Math.cos(p.d) + 3 + p.r / 2) * 0.6 * p.speed;
            p.x += Math.sin(p.tiltAngle) * 2;
            p.tilt = Math.sin(p.tiltAngle) * 15;

            ctx.beginPath();
            ctx.lineWidth = p.r;
            ctx.strokeStyle = p.color;
            ctx.moveTo(p.x + p.tilt + p.r / 4, p.y);
            ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 4);
            ctx.stroke();
        });
        confettiAnimId = requestAnimationFrame(render);
    }
    render();
}

async function loadProgressDashboard() {
    const container = document.getElementById('progressDashboardContent');
    container.innerHTML = '<div style="text-align:center;padding:3rem;"><i class="fa-solid fa-circle-notch fa-spin spin-anim" style="font-size:2rem;color:var(--primary);"></i></div>';

    try {
        const r = await fetch(`/api/auth/profile/${encodeURIComponent(USER_ID)}`);
        const user = await r.json();
        if (!r.ok) throw new Error(user.error);

        // Sync auth object with database
        auth = { ...auth, ...user };
        localStorage.setItem('tanim_auth', JSON.stringify(auth));
        updateNavState();

        const rank = getLearnerRank(user.xp || 0);

        // Leitner SRS Distribution
        const srsBoxes = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        (user.srsProgress || []).forEach(p => {
            const st = Math.min(5, Math.max(1, p.srsStage || 1));
            srsBoxes[st] = (srsBoxes[st] || 0) + 1;
        });
        const totalSrsCards = Object.values(srsBoxes).reduce((a, b) => a + b, 0);
        const retainedCards = (srsBoxes[4] || 0) + (srsBoxes[5] || 0);
        const retentionRate = totalSrsCards > 0 ? Math.round((retainedCards / totalSrsCards) * 100) : 100;

        // 22 Gamified Achievement Badges
        const achievementsList = [
            // General & Onboarding
            { id: 'first_login', title: 'Willkommen!', desc: 'Begann die Reise in die deutsche Sprache', icon: '🇩🇪', tier: 'bronze', category: 'general', xpReward: 25, current: 1, target: 1, unit: 'Start' },
            { id: 'daily_all', title: 'Tages-Champion', desc: 'Alle 4 Lernmodule an einem Tag gemeistert', icon: '⭐', tier: 'gold', category: 'general', xpReward: 150, current: (user.dailyModuleStatus || []).some(d => d.vocabCompleted && d.chatCompleted && d.writingCompleted && d.readingCompleted) ? 1 : 0, target: 1, unit: 'Tage' },

            // Vocabulary & Leitner SRS
            { id: 'first_word', title: 'Wortschatz Starter', desc: 'Erstes deutsches Wort im Karteikasten verankert', icon: '🌱', tier: 'bronze', category: 'vocab', xpReward: 25, current: user.totalWordsLearned || 0, target: 1, unit: 'Wort' },
            { id: 'vocab_10', title: 'Wortsammler', desc: '10+ Vokabeln im Langzeitgedächtnis trainiert', icon: '📚', tier: 'bronze', category: 'vocab', xpReward: 50, current: user.totalWordsLearned || 0, target: 10, unit: 'Wörter' },
            { id: 'vocab_25', title: 'Wortschatz-Kenner', desc: '25+ Wörter aktiv im Leitner-Wiederholungssystem', icon: '🧠', tier: 'silver', category: 'vocab', xpReward: 75, current: user.totalWordsLearned || 0, target: 25, unit: 'Wörter' },
            { id: 'vocab_50', title: 'Lexikon-Meister', desc: '50+ Wörter gemeistert — starker Wortschatz!', icon: '🏛️', tier: 'gold', category: 'vocab', xpReward: 125, current: user.totalWordsLearned || 0, target: 50, unit: 'Wörter' },
            { id: 'vocab_100', title: 'Sprach-Bibliothekar', desc: '100+ Wörter gelernt — wahrer Wortschatz-Gigant!', icon: '👑', tier: 'diamond', category: 'vocab', xpReward: 250, current: user.totalWordsLearned || 0, target: 100, unit: 'Wörter' },

            // Conversation & AI Immersion
            { id: 'first_chat', title: 'Plaudertasche', desc: 'Erste Konversation mit Lukas gewechselt', icon: '💬', tier: 'bronze', category: 'chat', xpReward: 25, current: user.totalMessages || 0, target: 1, unit: 'Nachricht' },
            { id: 'chat_15', title: 'Deutscher Redner', desc: '15+ Gesprächsrunden mit der KI geführt', icon: '🎙️', tier: 'silver', category: 'chat', xpReward: 75, current: user.totalMessages || 0, target: 15, unit: 'Nachrichten' },
            { id: 'chat_50', title: 'Lukas’ Bester Freund', desc: '50+ Nachrichten — fließende Dialogbereitschaft!', icon: '🗣️', tier: 'gold', category: 'chat', xpReward: 150, current: user.totalMessages || 0, target: 50, unit: 'Nachrichten' },
            { id: 'chat_100', title: 'Sprachgenie im Dialog', desc: '100+ Nachrichten — meisterhafte Gesprächsführung!', icon: '⚡', tier: 'diamond', category: 'chat', xpReward: 300, current: user.totalMessages || 0, target: 100, unit: 'Nachrichten' },

            // Writing & Essays
            { id: 'first_essay', title: 'Der Schriftsteller', desc: 'Ersten deutschen Aufsatz zur Bewertung eingereicht', icon: '✍️', tier: 'bronze', category: 'writing', xpReward: 30, current: user.essaysGraded || 0, target: 1, unit: 'Aufsatz' },
            { id: 'essay_3', title: 'Goethe-Lehrling', desc: '3+ Aufsätze mit Feedback analysiert und verbessert', icon: '📜', tier: 'silver', category: 'writing', xpReward: 80, current: user.essaysGraded || 0, target: 3, unit: 'Aufsätze' },
            { id: 'essay_high', title: 'Goldene Feder', desc: 'Einen Aufsatz mit 85+ Punkten absolviert', icon: '🖋️', tier: 'gold', category: 'writing', xpReward: 150, current: user.averageEssayScore || 0, target: 85, unit: 'Punkte' },

            // Graded Reading
            { id: 'first_story', title: 'Lesefuchs', desc: 'Erste interaktive CEFR-Geschichte gelesen', icon: '📖', tier: 'bronze', category: 'reading', xpReward: 25, current: user.storiesRead || 0, target: 1, unit: 'Story' },
            { id: 'stories_5', title: 'Bücherwurm', desc: '5+ CEFR-Geschichten aufmerksam durchgearbeitet', icon: '🦉', tier: 'silver', category: 'reading', xpReward: 75, current: user.storiesRead || 0, target: 5, unit: 'Stories' },

            // Streaks & Dedication
            { id: 'streak_3', title: 'Eiserne Disziplin', desc: '3 Tage in Folge ohne Unterbrechung geübt', icon: '🔥', tier: 'bronze', category: 'streak', xpReward: 40, current: user.streak || 1, target: 3, unit: 'Tage' },
            { id: 'streak_7', title: 'Feuer und Flamme', desc: '7-Tage-Streak! Eine ganze Woche voller Leidenschaft', icon: '🌋', tier: 'silver', category: 'streak', xpReward: 100, current: user.streak || 1, target: 7, unit: 'Tage' },
            { id: 'streak_14', title: 'Unaufhaltsam', desc: '14-Tage-Streak! Gewohnheit wird zur Meisterschaft', icon: '☄️', tier: 'gold', category: 'streak', xpReward: 200, current: user.streak || 1, target: 14, unit: 'Tage' },

            // XP Milestones
            { id: 'xp_100', title: 'XP-Pionier', desc: 'Erreiche 100 Erfahrungspunkte (XP)', icon: '🏆', tier: 'bronze', category: 'xp', xpReward: 25, current: user.xp || 0, target: 100, unit: 'XP' },
            { id: 'xp_500', title: 'Großer Gelehrter', desc: 'Erreiche 500 Erfahrungspunkte (XP)', icon: '🎖️', tier: 'silver', category: 'xp', xpReward: 75, current: user.xp || 0, target: 500, unit: 'XP' },
            { id: 'xp_1000', title: 'Titan der Sprache', desc: 'Über 1.000 XP angehäuft — wahrer Legendenstatus!', icon: '🌌', tier: 'diamond', category: 'xp', xpReward: 250, current: user.xp || 0, target: 1000, unit: 'XP' }
        ];

        const unlockedMap = new Map((user.achievements || []).map(a => [a.id, a]));
        const unlockedCount = achievementsList.filter(a => unlockedMap.has(a.id)).length;
        const totalBadges = achievementsList.length;

        // Update dashboard overview counter
        const overviewCounter = document.getElementById('trophiesUnlockedCount');
        if (overviewCounter) {
            overviewCounter.textContent = `${unlockedCount}/${totalBadges} Badges`;
        }

        // 7-Day Flame Streak Strip calculation
        const weekDays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
        const currentDayIdx = (new Date().getDay() + 6) % 7; // Monday = 0
        const streakDaysCount = Math.min(7, user.streak || 1);
        
        const streakNodesHtml = weekDays.map((dayName, idx) => {
            const isToday = idx === currentDayIdx;
            const isActive = (idx <= currentDayIdx && (currentDayIdx - idx) < streakDaysCount);
            return `
                <div class="streak-day-node ${isActive ? 'active' : ''} ${isToday ? 'today' : ''}" title="${dayName}">
                    <span>${dayName}</span>
                    <span style="font-size:1rem;">${isActive ? '🔥' : '○'}</span>
                </div>
            `;
        }).join('');

        // CEFR Mastery Rows
        const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
        const cefrRows = levels.map(l => {
            const prog = user.progressByLevel?.[l] || {};
            const isCurrent = (l === user.currentLevel);
            const basePct = isCurrent ? 55 : (l < user.currentLevel ? 100 : 15);
            const pct = Math.min(100, Math.max(10, (prog.wordsLearned || 0) * 8 + basePct));
            return `
                <div style="margin-bottom:0.85rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.8125rem;font-weight:700;margin-bottom:0.35rem;">
                        <span style="display:flex;align-items:center;gap:0.4rem;">
                            <span class="badge-level badge-${l.toLowerCase()}">Level ${l}</span>
                            ${isCurrent ? '<span style="font-size:0.7rem;color:var(--accent-amber);font-weight:800;">(Aktive Stufe)</span>' : ''}
                        </span>
                        <span style="color:var(--text-main);font-weight:800;">${pct}% Meisterschaft</span>
                    </div>
                    <div class="srs-progress-bar" style="height:8px;background:rgba(255,255,255,0.06);border-radius:999px;">
                        <div class="srs-progress-fill" style="width:${pct}%;border-radius:999px;"></div>
                    </div>
                </div>
            `;
        }).join('');

        // Trophies HTML Generator with Filtering Support
        function generateTrophyCardsHtml(filter = 'all') {
            return achievementsList.map(ach => {
                const unlockedRecord = unlockedMap.get(ach.id);
                const isUnlocked = !!unlockedRecord;

                // Category or Status filtering
                if (filter === 'unlocked' && !isUnlocked) return '';
                if (filter === 'locked' && isUnlocked) return '';
                if (filter === 'vocab' && ach.category !== 'vocab') return '';
                if (filter === 'chat' && ach.category !== 'chat') return '';
                if (filter === 'writing' && (ach.category !== 'writing' && ach.category !== 'reading')) return '';
                if (filter === 'streak' && (ach.category !== 'streak' && ach.category !== 'xp')) return '';

                const progressPct = isUnlocked ? 100 : Math.min(99, Math.round((Math.min(ach.current, ach.target) / ach.target) * 100));

                return `
                    <div class="trophy-card ${isUnlocked ? 'unlocked' : 'locked'} tier-${ach.tier}" data-badge-id="${ach.id}">
                        <div class="trophy-card-header">
                            <div class="trophy-icon-box">
                                <span>${ach.icon}</span>
                            </div>
                            <div class="trophy-content-group">
                                <div class="trophy-title-row">
                                    <span class="trophy-title" title="${esc(ach.title)}">${esc(ach.title)}</span>
                                    <span class="trophy-tier-tag ${ach.tier}">${ach.tier}</span>
                                </div>
                                <div class="trophy-desc">${esc(ach.desc)}</div>
                            </div>
                        </div>

                        ${isUnlocked ? `
                            <div class="trophy-unlocked-footer">
                                <span><i class="fa-solid fa-circle-check"></i> Freigeschaltet</span>
                                <span class="trophy-xp-bonus">+${ach.xpReward} XP</span>
                            </div>
                        ` : `
                            <div class="trophy-progress-wrap">
                                <div class="trophy-progress-text">
                                    <span>${ach.current} / ${ach.target} ${ach.unit}</span>
                                    <span>${progressPct}%</span>
                                </div>
                                <div class="trophy-progress-track">
                                    <div class="trophy-progress-fill" style="width:${progressPct}%;"></div>
                                </div>
                            </div>
                        `}
                    </div>
                `;
            }).join('');
        }

        container.innerHTML = `
            <!-- HERO LEARNER JOURNEY CARD -->
            <div class="journey-hero-card">
                <div class="journey-hero-top">
                    <div class="rank-avatar-wrap">
                        <div class="rank-shield glow-${rank.tier}">
                            <span>${esc(user.avatar || '🇩🇪')}</span>
                            <div class="rank-level-tag">LVL ${rank.level}</div>
                        </div>
                        <div class="rank-info-block">
                            <h3>
                                ${esc(user.username)}
                                <span class="badge-level badge-${(user.currentLevel || 'A2').toLowerCase()}">${esc(user.currentLevel || 'A2')}</span>
                            </h3>
                            <div class="rank-title-badge">
                                <span>${rank.icon}</span>
                                <span>Rang: ${esc(rank.title)}</span>
                            </div>
                        </div>
                    </div>
                    <div style="display:flex;gap:0.75rem;">
                        <button class="btn-secondary" id="editProfileShortcutBtn" style="padding:0.6rem 1.15rem;border-radius:var(--radius-full);">
                            <i class="fa-solid fa-pen-to-square"></i> Profil bearbeiten
                        </button>
                    </div>
                </div>

                <!-- XP LEVEL PROGRESS STRIP -->
                <div class="xp-level-strip">
                    <div class="xp-level-header">
                        <span style="color:var(--text-main);"><i class="fa-solid fa-bolt" style="color:var(--accent-amber);"></i> Stufe ${rank.level} &bull; ${rank.title}</span>
                        <span style="color:var(--accent-cyan);">${user.xp || 0} / ${rank.maxXp} XP &bull; <strong style="color:var(--text-main);">${rank.nextXp} XP</strong> bis Level ${rank.level + 1}</span>
                    </div>
                    <div class="xp-track-bar">
                        <div class="xp-track-fill" style="width:${rank.pct}%;"></div>
                    </div>
                </div>
            </div>

            <!-- 7-DAY STREAK FLAME TRACKER -->
            <div class="streak-calendar-strip">
                <div class="streak-cal-left">
                    <div class="streak-flame-icon">🔥</div>
                    <div>
                        <div style="font-size:1.1rem;font-weight:900;color:var(--text-main);">
                            ${user.streak || 1} Tage Lern-Serie
                        </div>
                        <div style="font-size:0.78rem;color:var(--text-muted);">
                            Halte das Feuer am Brennen! Übe täglich für Streak-Belohnungen.
                        </div>
                    </div>
                </div>
                <div class="streak-nodes-row">
                    ${streakNodesHtml}
                </div>
            </div>

            <!-- 4-COL STATS GRID -->
            <div class="stats-4col-grid">
                <div class="stat-box-card">
                    <div class="stat-box-num" style="color:var(--primary);">${user.xp || 0}</div>
                    <div class="stat-box-label"><i class="fa-solid fa-bolt" style="color:var(--accent-amber);"></i> Gesamt-XP</div>
                </div>
                <div class="stat-box-card">
                    <div class="stat-box-num" style="color:#f59e0b;">${user.streak || 1}</div>
                    <div class="stat-box-label"><i class="fa-solid fa-fire"></i> Tage Serie</div>
                </div>
                <div class="stat-box-card">
                    <div class="stat-box-num" style="color:#10b981;">${user.totalWordsLearned || 0}</div>
                    <div class="stat-box-label"><i class="fa-solid fa-book-bookmark"></i> Wörter Gelernt</div>
                </div>
                <div class="stat-box-card">
                    <div class="stat-box-num" style="color:#8b5cf6;">${user.totalMessages || 0}</div>
                    <div class="stat-box-label"><i class="fa-solid fa-comments"></i> Dialog-Runden</div>
                </div>
            </div>

            <!-- CEFR & LEITNER SRS PROGRESS -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
                <div class="glass-card" style="padding:1.5rem;">
                    <h4 style="font-size:1.05rem;font-weight:900;margin-bottom:1.15rem;display:flex;align-items:center;gap:0.5rem;">
                        <i class="fa-solid fa-graduation-cap" style="color:var(--primary);"></i> CEFR Stufen-Meisterschaft
                    </h4>
                    ${cefrRows}
                </div>

                <div class="glass-card" style="padding:1.5rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                        <h4 style="font-size:1.05rem;font-weight:900;display:flex;align-items:center;gap:0.5rem;">
                            <i class="fa-solid fa-boxes-stacked" style="color:var(--accent-cyan);"></i> Leitner SRS 5-Box Tresor
                        </h4>
                        <span style="font-size:0.8rem;font-weight:800;color:var(--accent-emerald);">${retentionRate}% Retention</span>
                    </div>
                    <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:1rem;">
                        Box 1 (Täglich) &rarr; Box 5 (Dauerhaftes Langzeitgedächtnis)
                    </p>
                    <div class="srs-box-visualizer">
                        <div class="srs-box-col stage-1">
                            <div class="srs-box-title">Box 1</div>
                            <div class="srs-box-count">${srsBoxes[1]}</div>
                        </div>
                        <div class="srs-box-col stage-2">
                            <div class="srs-box-title">Box 2</div>
                            <div class="srs-box-count">${srsBoxes[2]}</div>
                        </div>
                        <div class="srs-box-col stage-3">
                            <div class="srs-box-title">Box 3</div>
                            <div class="srs-box-count">${srsBoxes[3]}</div>
                        </div>
                        <div class="srs-box-col stage-4">
                            <div class="srs-box-title">Box 4</div>
                            <div class="srs-box-count">${srsBoxes[4]}</div>
                        </div>
                        <div class="srs-box-col stage-5">
                            <div class="srs-box-title">Box 5</div>
                            <div class="srs-box-count">${srsBoxes[5]}</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ACHIEVEMENTS & TROPHIES CABINET -->
            <div class="glass-card" style="padding:1.75rem;">
                <div class="badge-cabinet-header">
                    <div>
                        <h4 style="font-size:1.2rem;font-weight:900;display:flex;align-items:center;gap:0.6rem;color:var(--text-main);">
                            <i class="fa-solid fa-trophy" style="color:var(--accent-amber);"></i>
                            Erfolgs-Trophäen &amp; Abzeichen (${unlockedCount}/${totalBadges})
                        </h4>
                        <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem;">
                            Klicke auf ein Abzeichen für Details, XP-Boni und Meilensteine.
                        </div>
                    </div>
                    
                    <div class="badge-filter-bar" id="badgeFilterBar">
                        <button class="badge-filter-pill active" data-filter="all">Alle (${totalBadges})</button>
                        <button class="badge-filter-pill" data-filter="unlocked">Freigeschaltet (${unlockedCount})</button>
                        <button class="badge-filter-pill" data-filter="locked">In Arbeit (${totalBadges - unlockedCount})</button>
                        <button class="badge-filter-pill" data-filter="vocab">Vokabeln</button>
                        <button class="badge-filter-pill" data-filter="chat">Dialog</button>
                        <button class="badge-filter-pill" data-filter="writing">Schreiben &amp; Lesen</button>
                        <button class="badge-filter-pill" data-filter="streak">Serien &amp; XP</button>
                    </div>
                </div>

                <div class="trophy-grid" id="trophyGridContainer">
                    ${generateTrophyCardsHtml('all')}
                </div>
            </div>
        `;

        // Event: Edit profile shortcut
        document.getElementById('editProfileShortcutBtn')?.addEventListener('click', () => {
            openPanel('settings');
        });

        // Event: Badge Filtering
        const filterBar = document.getElementById('badgeFilterBar');
        const gridContainer = document.getElementById('trophyGridContainer');
        if (filterBar && gridContainer) {
            filterBar.querySelectorAll('.badge-filter-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    filterBar.querySelectorAll('.badge-filter-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const f = btn.dataset.filter || 'all';
                    gridContainer.innerHTML = generateTrophyCardsHtml(f);
                    bindBadgeInspectEvents();
                });
            });
        }

        // Event: Badge Inspection Modal
        function bindBadgeInspectEvents() {
            gridContainer.querySelectorAll('.trophy-card').forEach(card => {
                card.addEventListener('click', () => {
                    const badgeId = card.dataset.badgeId;
                    const badge = achievementsList.find(a => a.id === badgeId);
                    if (!badge) return;

                    const isUnlocked = unlockedMap.has(badgeId);
                    const modal = document.getElementById('badgeInspectModal');
                    if (!modal) return;

                    document.getElementById('modalBadgeIcon').textContent = badge.icon;
                    document.getElementById('modalBadgeTitle').textContent = badge.title;
                    document.getElementById('modalBadgeDesc').textContent = badge.desc;

                    const tierEl = document.getElementById('modalBadgeTier');
                    tierEl.className = `trophy-tier-tag ${badge.tier}`;
                    tierEl.textContent = `${badge.tier.toUpperCase()} TIER`;

                    const rewardEl = document.getElementById('modalBadgeReward');
                    rewardEl.textContent = `+${badge.xpReward} XP Belohnung`;

                    const statusLabel = document.getElementById('modalBadgeStatusLabel');
                    const percentEl = document.getElementById('modalBadgePercent');
                    const fillEl = document.getElementById('modalBadgeFill');

                    if (isUnlocked) {
                        statusLabel.innerHTML = '<span style="color:var(--accent-emerald);"><i class="fa-solid fa-circle-check"></i> Bereits Freigeschaltet!</span>';
                        percentEl.textContent = '100%';
                        fillEl.style.width = '100%';
                        fillEl.style.background = 'var(--accent-emerald)';
                        launchConfetti();
                    } else {
                        const pct = Math.min(99, Math.round((Math.min(badge.current, badge.target) / badge.target) * 100));
                        statusLabel.textContent = `Fortschritt: ${badge.current} / ${badge.target} ${badge.unit}`;
                        percentEl.textContent = `${pct}%`;
                        fillEl.style.width = `${pct}%`;
                        fillEl.style.background = 'var(--accent-cyan)';
                    }

                    modal.classList.add('active');
                });
            });
        }
        bindBadgeInspectEvents();

        // Close modal handlers
        const closeBtn = document.getElementById('closeBadgeModalBtn');
        const modal = document.getElementById('badgeInspectModal');
        closeBtn?.addEventListener('click', () => modal?.classList.remove('active'));
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });

    } catch (err) {
        container.innerHTML = `<div style="color:var(--accent-rose);text-align:center;padding:2rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(err.message)}</div>`;
    }
}

// =========================================================
// 8. SETTINGS & PROFILE MANAGEMENT
// =========================================================
let selectedAvatar = auth.avatar || '🇩🇪';

function loadSettingsModal() {
    document.getElementById('settingsUsernameField').value = auth.username || '';
    const nickField = document.getElementById('settingsNicknameField');
    if (nickField) nickField.value = (auth.nickname || auth.username || '').replace(/^@/, '');
    document.getElementById('settingsLevelSelect').value   = currentLevel;
    document.getElementById('dailyGoalXpSlider').value     = auth.dailyGoalXp || 30;
    document.getElementById('dailyGoalXpLabel').textContent = `${auth.dailyGoalXp || 30} XP`;
    document.getElementById('ttsRateSlider').value         = ttsRate;
    document.getElementById('ttsRateVal').textContent      = `${ttsRate}x`;

    // Highlight selected avatar
    document.querySelectorAll('.avatar-option-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.av === selectedAvatar);
    });

    // Populate model list dynamically from /api/settings/models
    fetchInstalledModels();
}

async function fetchInstalledModels() {
    try {
        const r = await fetch('/api/settings/models');
        const d = await r.json();
        const select = document.getElementById('settingsModelSelect');
        if (d.models && d.models.length && select) {
            const activeModel = auth.selectedModel || d.currentDefault || '';
            select.innerHTML = d.models.map(m => `
                <option value="${esc(m.name)}" ${m.name === activeModel ? 'selected' : ''}>
                    ${esc(m.name)} (${m.size || 'Local LLM'})
                </option>
            `).join('');
        }
    } catch (_) {}
}

// Instant model switch when user changes the dropdown in GUI
document.getElementById('settingsModelSelect')?.addEventListener('change', async (e) => {
    const selectedModel = e.target.value;
    const resEl = document.getElementById('modelTestResult');
    if (resEl) {
        resEl.style.display = 'block';
        resEl.style.color = 'var(--accent-cyan)';
        resEl.style.background = 'rgba(6, 182, 212, 0.1)';
        resEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin spin-anim"></i> Switching and pre-warming <strong>${esc(selectedModel)}</strong> in memory...`;
    }

    try {
        const r = await fetch('/api/settings/set-model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: selectedModel, userId: USER_ID })
        });
        const d = await r.json();
        if (d.success) {
            auth.selectedModel = selectedModel;
            localStorage.setItem('tanim_auth', JSON.stringify(auth));
            updateNavState();
            if (resEl) {
                resEl.style.color = 'var(--accent-emerald)';
                resEl.style.background = 'rgba(16, 185, 129, 0.12)';
                resEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Active LLM switched to <strong>${esc(selectedModel)}</strong>! (Ready in ${d.latencyMs}ms)`;
            }
            loadAiCoachRecommendations();
        } else {
            throw new Error(d.error);
        }
    } catch (err) {
        if (resEl) {
            resEl.style.color = 'var(--accent-rose)';
            resEl.style.background = 'rgba(239, 68, 68, 0.12)';
            resEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Model switch failed: ${esc(err.message)}`;
        }
    }
});

document.querySelectorAll('.avatar-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.avatar-option-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedAvatar = btn.dataset.av;
    });
});

document.querySelectorAll('.theme-select-card').forEach(card => {
    card.addEventListener('click', () => {
        setTheme(card.dataset.thm);
    });
});

document.getElementById('dailyGoalXpSlider')?.addEventListener('input', (e) => {
    document.getElementById('dailyGoalXpLabel').textContent = `${e.target.value} XP`;
});

document.getElementById('ttsRateSlider')?.addEventListener('input', (e) => {
    ttsRate = Number(e.target.value);
    document.getElementById('ttsRateVal').textContent = `${ttsRate}x`;
});

document.getElementById('testTtsVoiceBtn')?.addEventListener('click', () => {
    speakGerman('Hallo! Das ist die deutsche Sprachausgabe von OmniLang.');
});

document.getElementById('testModelBtn')?.addEventListener('click', async () => {
    const model = document.getElementById('settingsModelSelect')?.value;
    const resEl = document.getElementById('modelTestResult');
    resEl.style.display = 'block';
    resEl.style.color = 'var(--text-muted)';
    resEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin spin-anim"></i> Testing model latency...';

    try {
        const r = await fetch('/api/settings/test-model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model })
        });
        const d = await r.json();
        if (d.success) {
            resEl.style.color = 'var(--accent-emerald)';
            resEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${esc(d.model)} connected! Latency: <strong>${d.latencyMs}ms</strong>`;
        } else {
            throw new Error(d.error);
        }
    } catch (err) {
        resEl.style.color = 'var(--accent-rose)';
        resEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Model test failed: ${esc(err.message)}`;
    }
});

document.getElementById('saveSettingsBtn')?.addEventListener('click', async () => {
    const username = document.getElementById('settingsUsernameField')?.value.trim() || auth.username;
    const nickname = document.getElementById('settingsNicknameField')?.value.trim() || auth.nickname || username;
    const newLevel = document.getElementById('settingsLevelSelect')?.value || currentLevel;
    const dailyGoalXp = Number(document.getElementById('dailyGoalXpSlider')?.value || 30);
    const selectedModel = document.getElementById('settingsModelSelect')?.value || auth.selectedModel || '';
    const btn = document.getElementById('saveSettingsBtn');

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin spin-anim"></i> Saving...';

    try {
        const r = await fetch('/api/auth/settings/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: USER_ID,
                username,
                nickname,
                avatar: selectedAvatar,
                currentLevel: newLevel,
                dailyGoalXp,
                selectedModel,
                theme: activeTheme,
                ttsRate
            })
        });

        const d = await r.json();
        if (!r.ok) throw new Error(d.error);

        auth = { ...auth, ...d.user };
        currentLevel = newLevel;
        localStorage.setItem('tanim_auth', JSON.stringify(auth));
        updateNavState();

        btn.innerHTML = '<i class="fa-solid fa-check"></i> Saved!';
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Settings';
            closePanel('panel-settings');
            loadAiCoachRecommendations();
        }, 1000);

    } catch (err) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-xmark"></i> Save Failed';
    }
});

document.getElementById('resetProgressBtn')?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to reset your XP, streaks, and learning statistics?')) return;

    try {
        await fetch('/api/auth/reset-progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: USER_ID })
        });
        auth.xp = 0;
        auth.streak = 1;
        auth.totalWordsLearned = 0;
        auth.totalMessages = 0;
        localStorage.setItem('tanim_auth', JSON.stringify(auth));
        updateNavState();
        alert('Learning progress has been reset.');
        closePanel('panel-settings');
    } catch (_) {}
});

document.getElementById('logoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('tanim_auth');
    window.location.href = '/login.html';
});

// =========================================================
// 9. SPEECH SYNTHESIS & RECOGNITION UTILITIES
// =========================================================
function speakGerman(text) {
    if (!window.speechSynthesis || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';
    utterance.rate = ttsRate;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const deVoice = voices.find(v => v.lang.startsWith('de') || v.lang.includes('DE'));
    if (deVoice) utterance.voice = deVoice;
    window.speechSynthesis.speak(utterance);
}

function startSpeechRecognition(onResult, onError) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
        if (onError) onError();
        alert('Web Speech Recognition is not supported by your browser. Please use Chrome/Edge or type your text.');
        return;
    }

    const rec = new SpeechRec();
    rec.lang = 'de-DE';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = e => {
        if (e.results && e.results[0] && e.results[0][0]) {
            onResult(e.results[0][0].transcript);
        }
    };
    rec.onerror = () => { if (onError) onError(); };
    rec.onend = () => {};
    rec.start();
}

// Initialize all 5 modules with the user's saved CEFR level
applyGlobalLevelChange(currentLevel, false);
