import "./styles.css";
import rawQuestionBank from "../ccna.json";

const QUESTION_COUNT = 55;
const SESSION_STORAGE_KEY = "ccna-quiz-app/session-state/v2";
const QUESTION_BANKS = {
    ccna1: {
        label: "CCNA1",
        questionBank: rawQuestionBank,
        available: true,
        note: "A reset törli az aktuális válaszokat és egy új véletlen kérdéssort készít."
    },
    ccna2: {
        label: "CCNA2",
        questionBank: [],
        available: false,
        note: "A CCNA2 kérdésbank még nincs bekötve, de a választó már elő van készítve hozzá."
    }
};
const DEFAULT_TRACK_ID = "ccna1";

const state = {
    activeTrackId: DEFAULT_TRACK_ID,
    bank: [],
    examQuestions: [],
    answers: new Map(),
    submitted: false,
    results: [],
    activeQuestionId: null
};

const elements = {
    quizContainer: document.getElementById("quiz-container"),
    questionNav: document.getElementById("question-nav"),
    navStatusText: document.getElementById("nav-status-text"),
    trackSelect: document.getElementById("track-select"),
    trackNote: document.getElementById("track-note"),
    summaryPanel: document.getElementById("summary-panel"),
    reviewPanel: document.getElementById("review-panel"),
    evaluateButton: document.getElementById("evaluate-button"),
    resetButton: document.getElementById("reset-button"),
    answeredCount: document.getElementById("answered-count"),
    questionCount: document.getElementById("question-count"),
    poolCount: document.getElementById("pool-count")
};

function getSessionStorage() {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

function getActiveTrack() {
    return QUESTION_BANKS[state.activeTrackId] || QUESTION_BANKS[DEFAULT_TRACK_ID];
}

function setActiveTrack(trackId) {
    const nextTrack = QUESTION_BANKS[trackId];

    if (!nextTrack || !nextTrack.available) {
        state.activeTrackId = DEFAULT_TRACK_ID;
    } else {
        state.activeTrackId = trackId;
    }

    state.bank = getActiveTrack().questionBank
        .map(normalizeQuestion)
        .filter(Boolean);
}

function syncTrackControls() {
    const activeTrack = getActiveTrack();

    if (elements.trackSelect) {
        elements.trackSelect.value = state.activeTrackId;
    }

    if (elements.trackNote) {
        elements.trackNote.textContent = activeTrack.note;
    }
}

function serializeAnswers() {
    return Object.fromEntries(state.answers.entries());
}

function hydrateAnswers(rawAnswers) {
    if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) {
        return new Map();
    }

    return new Map(Object.entries(rawAnswers));
}

function isValidSavedQuestion(question) {
    if (!question || typeof question !== "object") {
        return false;
    }

    if (typeof question.id !== "string" || typeof question.prompt !== "string" || typeof question.type !== "string") {
        return false;
    }

    if (question.type === "choice") {
        return Array.isArray(question.options) && Array.isArray(question.correctAnswers);
    }

    if (question.type === "matching") {
        return Array.isArray(question.pairs) && Array.isArray(question.options);
    }

    return false;
}

function hasMatchingBankQuestions(examQuestions) {
    const bankQuestionIds = new Set(state.bank.map((question) => question.id));
    return examQuestions.every((question) => bankQuestionIds.has(question.id));
}

function saveSessionState() {
    const storage = getSessionStorage();

    if (!storage) {
        return;
    }

    const payload = {
        activeTrackId: state.activeTrackId,
        examQuestions: state.examQuestions,
        answers: serializeAnswers(),
        submitted: state.submitted,
        results: state.results
    };

    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
}

function clearSessionState() {
    const storage = getSessionStorage();

    if (!storage) {
        return;
    }

    storage.removeItem(SESSION_STORAGE_KEY);
}

function restoreSessionState() {
    const storage = getSessionStorage();

    if (!storage) {
        return false;
    }

    const rawState = storage.getItem(SESSION_STORAGE_KEY);

    if (!rawState) {
        return false;
    }

    try {
        const parsedState = JSON.parse(rawState);
        const savedTrackId = typeof parsedState.activeTrackId === "string" ? parsedState.activeTrackId : DEFAULT_TRACK_ID;
        const examQuestions = Array.isArray(parsedState.examQuestions) ? parsedState.examQuestions : [];
        const results = Array.isArray(parsedState.results) ? parsedState.results : [];

        setActiveTrack(savedTrackId);

        if (!examQuestions.length || !examQuestions.every(isValidSavedQuestion) || !hasMatchingBankQuestions(examQuestions)) {
            clearSessionState();
            return false;
        }

        state.examQuestions = examQuestions;
        state.answers = hydrateAnswers(parsedState.answers);
        state.submitted = Boolean(parsedState.submitted);
        state.results = state.submitted ? results : [];
        syncTrackControls();
        return true;
    } catch {
        clearSessionState();
        return false;
    }
}

function resetPanels() {
    elements.summaryPanel.classList.add("hidden");
    elements.reviewPanel.classList.add("hidden");
    elements.summaryPanel.innerHTML = "";
    elements.reviewPanel.innerHTML = "";
}

function shuffle(items) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
}

function sample(items, count) {
    return shuffle(items).slice(0, Math.min(count, items.length));
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function normalizeImagePath(path) {
    if (!path || typeof path !== "string") {
        return null;
    }

    if (path.startsWith("./")) {
        return path.slice(2);
    }

    return path;
}

function createMultipleChoiceQuestion(rawQuestion) {
    const variants = Array.isArray(rawQuestion.variants) ? rawQuestion.variants.filter(Boolean) : [];
    const variant = variants.length ? shuffle(variants)[0] : null;

    if (!variant || !Array.isArray(variant.answers) || !variant.answers.length) {
        return null;
    }

    const options = shuffle(
        variant.answers
            .filter((answer) => answer && typeof answer.text === "string")
            .map((answer, answerIndex) => ({
                id: `${rawQuestion.number}-${answerIndex}-${answer.text}`,
                text: answer.text,
                isCorrect: Boolean(answer.isCorrect)
            }))
    );

    const correctOptions = options.filter((option) => option.isCorrect).map((option) => option.text);

    if (!correctOptions.length) {
        return null;
    }

    return {
        id: `question-${rawQuestion.number}`,
        sourceNumber: rawQuestion.number,
        type: "choice",
        prompt: rawQuestion.question,
        images: Array.isArray(rawQuestion.images) ? rawQuestion.images.map(normalizeImagePath).filter(Boolean) : [],
        tables: Array.isArray(rawQuestion.tables) ? rawQuestion.tables : [],
        options,
        correctAnswers: correctOptions,
        selectionMode: correctOptions.length > 1 ? "multiple" : "single"
    };
}

function createMatchingQuestion(rawQuestion) {
    const table = Array.isArray(rawQuestion.tables) ? rawQuestion.tables.find((entry) => Array.isArray(entry.rows) && entry.rows.length) : null;

    if (!table) {
        return null;
    }

    const pairs = table.rows
        .filter((row) => Array.isArray(row) && row.length >= 2)
        .map((row, rowIndex) => ({
            id: `${rawQuestion.number}-pair-${rowIndex}`,
            left: row[0],
            right: row[1]
        }));

    if (!pairs.length) {
        return null;
    }

    return {
        id: `question-${rawQuestion.number}`,
        sourceNumber: rawQuestion.number,
        type: "matching",
        prompt: rawQuestion.question,
        images: Array.isArray(rawQuestion.images) ? rawQuestion.images.map(normalizeImagePath).filter(Boolean) : [],
        tables: [],
        pairs,
        options: shuffle(pairs.map((pair) => pair.right))
    };
}

function normalizeQuestion(rawQuestion) {
    if (!rawQuestion || !rawQuestion.question || rawQuestion.type === "missing-in-html") {
        return null;
    }

    if (rawQuestion.type === "matching") {
        return createMatchingQuestion(rawQuestion);
    }

    if (rawQuestion.type === "multiple-choice" || rawQuestion.type === "multi-variant") {
        return createMultipleChoiceQuestion(rawQuestion);
    }

    return null;
}

function getQuestionStatus(questionId) {
    if (!state.submitted) {
        return "unanswered";
    }

    const result = state.results.find((entry) => entry.id === questionId);
    return result && result.isCorrect ? "correct" : "incorrect";
}

function getNavigationStatus(question) {
    if (state.submitted) {
        return getQuestionStatus(question.id);
    }

    return isAnswered(question) ? "answered" : "unanswered";
}

function isAnswered(question) {
    const answer = state.answers.get(question.id);

    if (question.type === "choice") {
        if (question.selectionMode === "single") {
            return typeof answer === "string" && answer.length > 0;
        }

        return Array.isArray(answer) && answer.length > 0;
    }

    if (question.type === "matching") {
        return Boolean(answer) && question.pairs.every((pair) => Boolean(answer[pair.id]));
    }

    return false;
}

function updateProgress() {
    const answered = state.examQuestions.filter(isAnswered).length;
    elements.answeredCount.textContent = `${answered} / ${state.examQuestions.length}`;
    elements.questionCount.textContent = `${getActiveTrack().label} · ${state.examQuestions.length} kérdés`;
    elements.poolCount.textContent = String(state.bank.length);

    if (elements.navStatusText) {
        if (state.submitted) {
            const correctCount = state.results.filter((entry) => entry.isCorrect).length;
            elements.navStatusText.textContent = `${correctCount}/${state.examQuestions.length} helyes`;
        } else {
            elements.navStatusText.textContent = `${answered}/${state.examQuestions.length} kitöltve`;
        }
    }
}

function setActiveQuestion(questionId) {
    if (!questionId || state.activeQuestionId === questionId) {
        return;
    }

    state.activeQuestionId = questionId;

    if (!elements.questionNav) {
        return;
    }

    const navButtons = elements.questionNav.querySelectorAll(".question-nav-button");
    navButtons.forEach((button) => {
        const isActive = button.dataset.questionId === questionId;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-current", isActive ? "true" : "false");
    });
}

function renderQuestionNavigation() {
    if (!elements.questionNav) {
        return;
    }

    elements.questionNav.innerHTML = state.examQuestions.map((question, index) => {
        const status = getNavigationStatus(question);
        const isActive = question.id === state.activeQuestionId;

        return `
            <button
                type="button"
                class="question-nav-button ${status} ${isActive ? "active" : ""}"
                data-question-id="${escapeHtml(question.id)}"
                aria-label="Ugrás a(z) ${index + 1}. kérdésre"
                aria-current="${isActive ? "true" : "false"}"
            >
                ${index + 1}
            </button>
        `;
    }).join("");
}

function scrollToQuestion(questionId) {
    const questionElement = document.getElementById(questionId);

    if (!questionElement) {
        return;
    }

    setActiveQuestion(questionId);
    questionElement.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncActiveQuestionWithViewport() {
    const questionCards = [...document.querySelectorAll(".question-card")];

    if (!questionCards.length) {
        return;
    }

    const viewportAnchor = window.innerHeight * 0.24;
    let closestId = questionCards[0].id;
    let minDistance = Number.POSITIVE_INFINITY;

    questionCards.forEach((card) => {
        const distance = Math.abs(card.getBoundingClientRect().top - viewportAnchor);
        if (distance < minDistance) {
            minDistance = distance;
            closestId = card.id;
        }
    });

    setActiveQuestion(closestId);
}

function renderTables(question) {
    if (!Array.isArray(question.tables) || !question.tables.length) {
        return "";
    }

    return question.tables.map((table) => {
        const headers = Array.isArray(table.headers) ? table.headers : [];
        const headerMarkup = headers.length
            ? `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`
            : "";
        const bodyMarkup = `<tbody>${(table.rows || []).map((row) => `<tr>${(row || []).map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
        return `<table class="question-table">${headerMarkup}${bodyMarkup}</table>`;
    }).join("");
}

function renderImages(question) {
    if (!Array.isArray(question.images) || !question.images.length) {
        return "";
    }

    return `<div class="image-strip">${question.images.map((src) => `<img src="${escapeHtml(src)}" alt="Kérdéshez tartozó ábra" loading="lazy" onerror="this.remove()">`).join("")}</div>`;
}

function renderChoiceOptions(question, result) {
    const inputType = question.selectionMode === "multiple" ? "checkbox" : "radio";
    const currentValue = state.answers.get(question.id);
    const selectedValues = question.selectionMode === "multiple"
        ? new Set(Array.isArray(currentValue) ? currentValue : [])
        : new Set(typeof currentValue === "string" ? [currentValue] : []);

    return `<div class="option-list">${question.options.map((option) => {
        const checked = selectedValues.has(option.text) ? "checked" : "";
        const correctClass = result && option.isCorrect ? "correct-answer" : "";
        const wrongClass = result && !result.isCorrect && selectedValues.has(option.text) && !option.isCorrect ? "user-wrong" : "";
        const disabled = state.submitted ? "disabled" : "";

        return `
            <label class="option-item ${correctClass} ${wrongClass}">
                <input
                    type="${inputType}"
                    name="${escapeHtml(question.id)}"
                    value="${escapeHtml(option.text)}"
                    data-question-id="${escapeHtml(question.id)}"
                    ${checked}
                    ${disabled}
                >
                <span>${escapeHtml(option.text)}</span>
            </label>
        `;
    }).join("")}</div>`;
}

function renderMatchingOptions(question, result) {
    const currentValue = state.answers.get(question.id) || {};
    return `<div class="matching-grid">${question.pairs.map((pair) => {
        const selected = currentValue[pair.id] || "";
        const isCorrectPair = result ? result.detail.every((detail) => detail.pairId !== pair.id || detail.isCorrect) : false;
        const isWrongPair = result ? result.detail.some((detail) => detail.pairId === pair.id && !detail.isCorrect) : false;
        const disabled = state.submitted ? "disabled" : "";
        const optionsMarkup = ["<option value=''>Válassz párost</option>"]
            .concat(question.options.map((option) => `<option value="${escapeHtml(option)}" ${selected === option ? "selected" : ""}>${escapeHtml(option)}</option>`))
            .join("");

        return `
            <div class="matching-row ${isCorrectPair ? "correct-answer" : ""} ${isWrongPair ? "user-wrong" : ""}">
                <div>
                    <strong>${escapeHtml(pair.left)}</strong>
                    ${state.submitted ? `<p class="support-text">Helyes páros: ${escapeHtml(pair.right)}</p>` : ""}
                </div>
                <select data-question-id="${escapeHtml(question.id)}" data-pair-id="${escapeHtml(pair.id)}" ${disabled}>
                    ${optionsMarkup}
                </select>
            </div>
        `;
    }).join("")}</div>`;
}

function getInstruction(question) {
    if (question.type === "matching") {
        return "Párosítsd össze a leírásokat a megfelelő elemekkel.";
    }

    if (question.selectionMode === "multiple") {
        return `Több válasz helyes. Pontosan ${question.correctAnswers.length} elemet jelölj meg.`;
    }

    return "Egy helyes választ jelölj meg.";
}

function renderQuestions() {
    elements.quizContainer.innerHTML = state.examQuestions.map((question, index) => {
        const result = state.results.find((entry) => entry.id === question.id);
        const status = getQuestionStatus(question.id);

        return `
            <article class="question-card ${status}" id="${escapeHtml(question.id)}">
                <div class="question-header">
                    <div>
                        <span class="question-index">${index + 1}. kérdés <span>forrás: #${question.sourceNumber}</span></span>
                        <p class="question-meta">${escapeHtml(getInstruction(question))}</p>
                    </div>
                    ${state.submitted ? `<span class="result-pill ${result && result.isCorrect ? "correct" : "incorrect"}">${result && result.isCorrect ? "Helyes" : "Hibás"}</span>` : `<span class="question-badge">Vizsga közben</span>`}
                </div>
                <h3 class="question-text">${escapeHtml(question.prompt)}</h3>
                ${renderImages(question)}
                ${renderTables(question)}
                ${question.type === "choice" ? renderChoiceOptions(question, result) : renderMatchingOptions(question, result)}
            </article>
        `;
    }).join("");

    if (!state.activeQuestionId && state.examQuestions.length) {
        state.activeQuestionId = state.examQuestions[0].id;
    }

    renderQuestionNavigation();
    updateProgress();
    syncActiveQuestionWithViewport();
}

function setChoiceAnswer(questionId, value, checked) {
    const question = state.examQuestions.find((entry) => entry.id === questionId);

    if (!question || question.type !== "choice") {
        return;
    }

    if (question.selectionMode === "single") {
        state.answers.set(questionId, value);
        return;
    }

    const currentValues = new Set(Array.isArray(state.answers.get(questionId)) ? state.answers.get(questionId) : []);

    if (checked) {
        currentValues.add(value);
    } else {
        currentValues.delete(value);
    }

    state.answers.set(questionId, [...currentValues]);
}

function setMatchingAnswer(questionId, pairId, value) {
    const currentValue = { ...(state.answers.get(questionId) || {}) };
    currentValue[pairId] = value;
    state.answers.set(questionId, currentValue);
}

function arraysEqualAsSet(left, right) {
    const leftSet = new Set(left);
    const rightSet = new Set(right);

    if (leftSet.size !== rightSet.size) {
        return false;
    }

    return [...leftSet].every((value) => rightSet.has(value));
}

function gradeChoiceQuestion(question) {
    const rawAnswer = state.answers.get(question.id);
    const userAnswers = question.selectionMode === "single"
        ? (typeof rawAnswer === "string" && rawAnswer ? [rawAnswer] : [])
        : (Array.isArray(rawAnswer) ? rawAnswer : []);

    return {
        id: question.id,
        prompt: question.prompt,
        sourceNumber: question.sourceNumber,
        isCorrect: arraysEqualAsSet(userAnswers, question.correctAnswers),
        userAnswerText: userAnswers.length ? userAnswers.join(", ") : "Nincs válasz",
        correctAnswerText: question.correctAnswers.join(", ")
    };
}

function gradeMatchingQuestion(question) {
    const rawAnswer = state.answers.get(question.id) || {};
    const detail = question.pairs.map((pair) => ({
        pairId: pair.id,
        left: pair.left,
        expected: pair.right,
        selected: rawAnswer[pair.id] || "Nincs válasz",
        isCorrect: rawAnswer[pair.id] === pair.right
    }));

    return {
        id: question.id,
        prompt: question.prompt,
        sourceNumber: question.sourceNumber,
        isCorrect: detail.every((entry) => entry.isCorrect),
        detail,
        userAnswerText: detail.map((entry) => `${entry.left} -> ${entry.selected}`).join(" | "),
        correctAnswerText: detail.map((entry) => `${entry.left} -> ${entry.expected}`).join(" | ")
    };
}

function evaluateExam() {
    state.results = state.examQuestions.map((question) => {
        if (question.type === "matching") {
            return gradeMatchingQuestion(question);
        }

        return gradeChoiceQuestion(question);
    });
    state.submitted = true;
    renderQuestions();
    renderSummary();
    renderReview();
    saveSessionState();
    elements.summaryPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderSummary() {
    const correctCount = state.results.filter((entry) => entry.isCorrect).length;
    const incorrectCount = state.results.length - correctCount;
    const unansweredCount = state.examQuestions.filter((question) => !isAnswered(question)).length;
    const percent = state.results.length ? Math.round((correctCount / state.results.length) * 100) : 0;

    elements.summaryPanel.classList.remove("hidden");
    elements.summaryPanel.innerHTML = `
        <h2>Eredmény</h2>
        <p class="result-meta">A kiértékelés az aktuális 55 kérdéses vizsgára készült el.</p>
        <div class="summary-grid">
            <div class="summary-card">
                <span>Helyes</span>
                <strong>${correctCount}</strong>
            </div>
            <div class="summary-card">
                <span>Hibás</span>
                <strong>${incorrectCount}</strong>
            </div>
            <div class="summary-card">
                <span>Találati arány</span>
                <strong>${percent}%</strong>
            </div>
        </div>
        <p class="result-meta">Megválaszolatlan kérdés a kiértékelés pillanatában: ${unansweredCount}</p>
    `;
}

function renderReview() {
    const incorrectResults = state.results.filter((entry) => !entry.isCorrect);

    elements.reviewPanel.classList.remove("hidden");

    if (!incorrectResults.length) {
        elements.reviewPanel.innerHTML = `
            <h2>Hibák áttekintése</h2>
            <p class="result-meta">Ebben a körben nincs hibás válasz. A reset gombbal új kérdéssort kérhetsz.</p>
        `;
        return;
    }

    elements.reviewPanel.innerHTML = `
        <h2>Hibák áttekintése</h2>
        <p class="result-meta">Az alábbi kérdéseknél látszik, mit választottál és mi lett volna a jó megoldás.</p>
        ${incorrectResults.map((result) => `
            <article class="review-item">
                <span class="question-badge">Forrás kérdés: #${result.sourceNumber}</span>
                <h3 class="question-text">${escapeHtml(result.prompt)}</h3>
                <p class="review-answer"><strong>A te válaszod:</strong> ${escapeHtml(result.userAnswerText)}</p>
                <p class="review-correct"><strong>Helyes válasz:</strong> ${escapeHtml(result.correctAnswerText)}</p>
            </article>
        `).join("")}
    `;
}

function generateExam() {
    clearSessionState();
    state.examQuestions = sample(state.bank, QUESTION_COUNT);
    state.answers = new Map();
    state.results = [];
    state.submitted = false;
    state.activeQuestionId = state.examQuestions[0]?.id ?? null;
    resetPanels();
    renderQuestions();
    saveSessionState();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindEvents() {
    elements.quizContainer.addEventListener("change", (event) => {
        if (state.submitted) {
            return;
        }

        const target = event.target;

        if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
            return;
        }

        const questionId = target.dataset.questionId;

        if (!questionId) {
            return;
        }

        if (target instanceof HTMLInputElement) {
            setChoiceAnswer(questionId, target.value, target.checked);
        }

        if (target instanceof HTMLSelectElement) {
            setMatchingAnswer(questionId, target.dataset.pairId, target.value);
        }

        updateProgress();
        renderQuestionNavigation();
        saveSessionState();
    });

    elements.trackSelect.addEventListener("change", (event) => {
        const target = event.target;

        if (!(target instanceof HTMLSelectElement)) {
            return;
        }

        setActiveTrack(target.value);
        syncTrackControls();
        generateExam();
    });

    elements.questionNav.addEventListener("click", (event) => {
        const target = event.target;

        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        const { questionId } = target.dataset;

        if (!questionId) {
            return;
        }

        scrollToQuestion(questionId);
    });

    window.addEventListener("scroll", syncActiveQuestionWithViewport, { passive: true });

    elements.evaluateButton.addEventListener("click", evaluateExam);
    elements.resetButton.addEventListener("click", generateExam);
}

function init() {
    setActiveTrack(DEFAULT_TRACK_ID);
    syncTrackControls();

    bindEvents();

    if (restoreSessionState()) {
        state.activeQuestionId = state.examQuestions[0]?.id ?? null;
        renderQuestions();

        if (state.submitted) {
            renderSummary();
            renderReview();
        } else {
            resetPanels();
        }

        return;
    }

    generateExam();
}

init();