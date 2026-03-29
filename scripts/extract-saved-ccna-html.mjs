import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const EXPECTED_QUESTION_COUNT = 174;
const PUBLIC_ASSET_DIR = "ccna2-assets";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");

function normalizeWhitespace(value) {
    return String(value ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function toPosixPath(value) {
    return value.split(path.sep).join("/");
}

function toPublicImagePath(relativeImagePath) {
    const posixPath = relativeImagePath.replace(/\\/g, "/");
    const fileName = path.posix.basename(posixPath);
    return `./${PUBLIC_ASSET_DIR}/${fileName}`;
}

function isQuestionStart($, node) {
    if (!node || node.type !== "tag" || node.name !== "p") {
        return false;
    }

    return /^\d+\.\s+/.test(normalizeWhitespace($(node).text()));
}

function extractQuestionStart($, node) {
    const rawText = normalizeWhitespace($(node).text());
    const match = rawText.match(/^(\d+)\.\s*(.+)$/);

    if (!match) {
        return null;
    }

    let prompt = match[2].trim();
    let inlineCaseLabel = null;
    const caseMatch = prompt.match(/^(.*?)(?:\s+(Case\s+\d+(?:\s+\(NEW\))?:))$/i);

    if (caseMatch) {
        prompt = caseMatch[1].trim();
        inlineCaseLabel = caseMatch[2].trim();
    }

    return {
        number: Number(match[1]),
        prompt,
        inlineCaseLabel
    };
}

function extractImages($, node, images) {
    if (!node || node.type !== "tag") {
        return;
    }

    const imageElements = node.name === "img" ? $(node) : $(node).find("img");
    imageElements.each((_, image) => {
        const src = normalizeWhitespace($(image).attr("src"));

        if (!src || /^https?:\/\//i.test(src) || src.startsWith("data:")) {
            return;
        }

        images.add(src.startsWith("./") ? src : `./${src}`);
    });
}

function extractTable($, tableElement) {
    const headers = [];
    const rows = [];
    const table = $(tableElement);

    table.find("thead tr").first().children("th, td").each((_, cell) => {
        headers.push(normalizeWhitespace($(cell).text()));
    });

    const bodyRows = table.find("tbody tr").length ? table.find("tbody tr") : table.find("tr");

    bodyRows.each((_, row) => {
        const cells = [];
        $(row).children("th, td").each((__, cell) => {
            cells.push(normalizeWhitespace($(cell).text()));
        });

        if (cells.length) {
            rows.push(cells);
        }
    });

    if (headers.length && rows.length && rows[0].join("|") === headers.join("|")) {
        rows.shift();
    }

    return {
        headers,
        rows
    };
}

function isCorrectAnswer($, answerElement) {
    const answer = $(answerElement);
    const html = answer.html() || "";

    if (answer.hasClass("correct_answer")) {
        return true;
    }

    return /(color\s*:\s*(?:#ff0000|red))/i.test(html);
}

function extractAnswers($, listElement) {
    const answers = [];

    $(listElement).children("li").each((_, item) => {
        const text = normalizeWhitespace($(item).text());

        if (!text) {
            return;
        }

        answers.push({
            text,
            isCorrect: isCorrectAnswer($, item)
        });
    });

    return answers;
}

function createMissingQuestion(number, note) {
    return {
        number,
        type: "missing-in-html",
        question: null,
        images: [],
        variants: [],
        tables: [],
        note
    };
}

function parseQuestionBlock($, block) {
    const images = new Set();
    const tables = [];
    const variants = [];
    const promptParts = [block.prompt];
    let pendingCaseLabel = block.inlineCaseLabel;
    let answerSectionStarted = false;
    let explanationStarted = false;

    for (const node of block.nodes) {
        extractImages($, node, images);

        if (!node || node.type !== "tag") {
            continue;
        }

        const element = $(node);

        if (element.hasClass("message_box") && /Explanation:/i.test(normalizeWhitespace(element.text()))) {
            explanationStarted = true;
            continue;
        }

        if (explanationStarted) {
            continue;
        }

        if (node.name === "table") {
            const table = extractTable($, node);
            if (table.rows.length || table.headers.length) {
                tables.push(table);
                answerSectionStarted = true;
            }
            continue;
        }

        if (node.name === "ul") {
            const answers = extractAnswers($, node);

            if (answers.length) {
                variants.push({
                    label: pendingCaseLabel ?? null,
                    answers,
                    correctAnswers: answers.filter((answer) => answer.isCorrect).map((answer) => answer.text),
                    incorrectAnswers: answers.filter((answer) => !answer.isCorrect).map((answer) => answer.text)
                });
                answerSectionStarted = true;
                pendingCaseLabel = null;
            }

            continue;
        }

        if (node.name !== "p" && node.name !== "pre") {
            continue;
        }

        const text = normalizeWhitespace(element.text());

        if (!text) {
            continue;
        }

        if (/^Case\s+\d+/i.test(text)) {
            pendingCaseLabel = text;
            continue;
        }

        if (/^Explanation:/i.test(text) || /^Reference:/i.test(text)) {
            explanationStarted = true;
            continue;
        }

        if (!answerSectionStarted) {
            promptParts.push(text);
        }
    }

    const question = normalizeWhitespace(promptParts.join(" "));
    const normalizedImages = [...images];

    if (variants.length > 1) {
        return {
            number: block.number,
            type: "multi-variant",
            question,
            images: normalizedImages,
            variants,
            tables
        };
    }

    if (variants.length === 1) {
        return {
            number: block.number,
            type: "multiple-choice",
            question,
            images: normalizedImages,
            variants,
            tables
        };
    }

    if (tables.some((table) => table.rows.length)) {
        return {
            number: block.number,
            type: "matching",
            question,
            images: normalizedImages,
            variants: [],
            tables
        };
    }

    return {
        number: block.number,
        type: "unsupported-in-html",
        question,
        images: normalizedImages,
        variants: [],
        tables,
        note: "The saved HTML includes this question, but no textual answer set was available to extract reliably."
    };
}

async function ensureDirectory(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
}

async function copyQuestionImages(questionBank, sourceDir, publicDir) {
    const imagePaths = new Set(
        questionBank
            .flatMap((question) => question.images || [])
            .filter((imagePath) => typeof imagePath === "string" && imagePath.startsWith("./"))
    );

    for (const relativeImagePath of imagePaths) {
        const sourcePath = path.resolve(sourceDir, relativeImagePath);
        const targetPath = path.resolve(publicDir, toPublicImagePath(relativeImagePath).slice(2));

        await ensureDirectory(path.dirname(targetPath));
        await fs.copyFile(sourcePath, targetPath);
    }
}

async function main() {
    const [sourceHtmlPath, outputFileName = "ccna2.json"] = process.argv.slice(2);

    if (!sourceHtmlPath) {
        console.error("Usage: node scripts/extract-saved-ccna-html.mjs <saved-html-path> [output-json]");
        process.exitCode = 1;
        return;
    }

    const resolvedHtmlPath = path.resolve(sourceHtmlPath);
    const sourceDir = path.dirname(resolvedHtmlPath);
    const html = await fs.readFile(resolvedHtmlPath, "utf8");
    const sectionStartToken = '<div class="post-single-content box mark-links entry-content">';
    const sectionEndToken = '<div class="nav-links">';
    const sectionStartIndex = html.indexOf(sectionStartToken);
    const sectionEndIndex = html.indexOf(sectionEndToken, sectionStartIndex);

    if (sectionStartIndex === -1 || sectionEndIndex === -1) {
        throw new Error("Question content section was not found in the saved HTML.");
    }

    const questionSection = html.slice(sectionStartIndex + sectionStartToken.length, sectionEndIndex);
    const questionStartRegex = /<p>\s*<(?:strong|b)>\s*(\d+)\./gi;
    const questionMatches = [...questionSection.matchAll(questionStartRegex)];

    if (!questionMatches.length) {
        throw new Error("No numbered question blocks were found in the saved HTML content section.");
    }

    const questionBlocks = [];

    for (let index = 0; index < questionMatches.length; index += 1) {
        const currentMatch = questionMatches[index];
        const nextMatch = questionMatches[index + 1];
        const blockHtml = questionSection.slice(currentMatch.index, nextMatch ? nextMatch.index : undefined);
        const fragment = load(`<div id="fragment-root">${blockHtml}</div>`, { decodeEntities: false });
        const root = fragment("#fragment-root");
        const startNode = root.children().first().get(0);
        const questionStart = extractQuestionStart(fragment, startNode);

        if (!questionStart) {
            continue;
        }

        questionBlocks.push({
            number: questionStart.number,
            prompt: questionStart.prompt,
            inlineCaseLabel: questionStart.inlineCaseLabel,
            blockHtml
        });
    }

    const questionBank = [];
    let expectedNumber = 1;

    for (const block of questionBlocks) {
        while (expectedNumber < block.number) {
            questionBank.push(createMissingQuestion(expectedNumber, "This question number is missing from the saved HTML source."));
            expectedNumber += 1;
        }

        const fragment = load(`<div id="fragment-root">${block.blockHtml}</div>`, { decodeEntities: false });
        const root = fragment("#fragment-root");
        questionBank.push(parseQuestionBlock(fragment, {
            ...block,
            nodes: root.contents().toArray().slice(1)
        }));
        expectedNumber = block.number + 1;
    }

    while (expectedNumber <= EXPECTED_QUESTION_COUNT) {
        questionBank.push(createMissingQuestion(expectedNumber, "This question number is missing from the saved HTML source."));
        expectedNumber += 1;
    }

    const publicQuestionBank = questionBank.map((question) => ({
        ...question,
        images: (question.images || []).map((imagePath) => toPublicImagePath(imagePath))
    }));

    const outputPath = path.resolve(workspaceRoot, outputFileName);
    await fs.writeFile(outputPath, `${JSON.stringify(publicQuestionBank, null, 4)}\n`, "utf8");
    await copyQuestionImages(questionBank, sourceDir, path.resolve(workspaceRoot, "public"));

    const summary = publicQuestionBank.reduce((accumulator, question) => {
        accumulator[question.type] = (accumulator[question.type] || 0) + 1;
        return accumulator;
    }, {});

    console.log(JSON.stringify({
        output: toPosixPath(path.relative(workspaceRoot, outputPath)),
        total: publicQuestionBank.length,
        summary
    }, null, 2));
}

await main();