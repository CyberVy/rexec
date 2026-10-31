/* eslint-disable */
import path from "path";

const jsxTextIndentRule = {
    meta: {
        type: "layout",
        docs: {
            description: "Enforce indentation for multiline JSX text nodes"
        },
        fixable: "whitespace",
        schema: [{
            type: "integer",
            minimum: 0
        }],
        messages: {
            wrongIndent: "Expected JSX text indentation of {{expected}} spaces but found {{actual}}."
        }
    },
    create(context) {
        const sourceCode = context.sourceCode;
        const indentSize = typeof context.options[0] === "number" ? context.options[0] : 4;
        const reportedLineSet = new Set();

        return {
            JSXText(node) {
                const rawText = sourceCode.getText(node);
                if (!rawText.includes("\n")) {
                    return;
                }

                if (!node.parent || node.parent.type !== "JSXElement") {
                    return;
                }

                const parentIndent = node.parent.openingElement.loc.start.column;
                const expectedIndent = parentIndent + indentSize;
                const startLine = node.loc.start.line + 1;
                const endLine = node.loc.end.line;

                for (let line = startLine; line <= endLine; line += 1) {
                    const fullLine = sourceCode.lines[line - 1] || "";
                    const firstNonWhitespace = fullLine.search(/\S/u);

                    if (firstNonWhitespace === -1) {
                        continue;
                    }

                    const lineStartIndex = sourceCode.getIndexFromLoc({ line, column: 0 });
                    const firstTokenIndex = lineStartIndex + firstNonWhitespace;
                    if (firstTokenIndex < node.range[0] || firstTokenIndex >= node.range[1]) {
                        continue;
                    }

                    const reportKey = `${node.range[0]}:${line}`;
                    if (reportedLineSet.has(reportKey)) {
                        continue;
                    }

                    if (firstNonWhitespace !== expectedIndent) {
                        reportedLineSet.add(reportKey);
                        context.report({
                            node,
                            loc: {
                                start: { line, column: 0 },
                                end: { line, column: firstNonWhitespace }
                            },
                            messageId: "wrongIndent",
                            data: {
                                expected: expectedIndent,
                                actual: firstNonWhitespace
                            },
                            fix(fixer) {
                                return fixer.replaceTextRange(
                                    [lineStartIndex, lineStartIndex + firstNonWhitespace],
                                    " ".repeat(expectedIndent)
                                );
                            }
                        });
                    }
                }
            }
        };
    }
};

const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F000}-\u{1F0FF}\u{1F1E6}-\u{1F1FF}]/u;

const noEmojisRule = {
    meta: {
        type: "suggestion",
        docs: {
            description: "Enforce emoji prohibition in UI text and code"
        },
        messages: {
            noEmoji: "Do not use emojis in any UI text, icons, or code (emoji found: '{{emoji}}')."
        }
    },
    create(context) {
        function check_text(node, text) {
            if (!text || typeof text !== "string") return;
            // Fast-path: Skip pure ASCII strings as emojis are in unicode high-plane
            if (/^[\x00-\x7F]*$/.test(text)) return;

            const match = text.match(emojiRegex);
            if (match) {
                context.report({
                    node,
                    messageId: "noEmoji",
                    data: {
                        emoji: match[0]
                    }
                });
            }
        }

        return {
            JSXText(node) {
                check_text(node, node.value);
            },
            Literal(node) {
                if (typeof node.value === "string") {
                    check_text(node, node.value);
                }
            },
            TemplateElement(node) {
                if (node.value && typeof node.value.cooked === "string") {
                    check_text(node, node.value.cooked);
                }
            }
        };
    }
};

const noInlineSvgsRule = {
    meta: {
        type: "suggestion",
        docs: {
            description: "Enforce SVG icon component centralization in icons.tsx"
        },
        messages: {
            noInlineSvg: "Do not use inline <svg> tags outside of icons.tsx. Write SVG components in the corresponding icons.tsx and import them instead."
        }
    },
    create(context) {
        const filename = context.filename || (context.getFilename && context.getFilename()) || "";
        const isIconFile = filename.endsWith("icons.tsx") || filename.endsWith("icons.ts");
        if (isIconFile) return {};

        return {
            JSXOpeningElement(node) {
                if (node.name && node.name.name === "svg") {
                    context.report({
                        node,
                        messageId: "noInlineSvg"
                    });
                }
            }
        };
    }
};

const layeringRestrictionsRule = {
    meta: {
        type: "suggestion",
        docs: {
            description: "Enforce module dependency layering rules"
        },
        messages: {
            noComponentsToBlocks: "Layering violation: 'frontend/components/' must not depend on 'frontend/blocks/' or 'frontend/app/'.",
            noUiInNonUi: "Layering violation: Non-UI file '{{file}}' must not import UI-related directory '{{imported}}'.",
            noCoreInInfra: "Layering violation: 'frontend/infra/' must not depend on 'frontend/core/'."
        }
    },
    create(context) {
        const filename = context.filename || (context.getFilename && context.getFilename()) || "";
        const relativeFile = path.relative(process.cwd(), filename).replace(/\\/g, "/");

        const UI_DIRS = ["frontend/app/", "frontend/blocks/", "frontend/components/"];
        const isUiFile = UI_DIRS.some(dir => relativeFile.startsWith(dir));

        function get_resolved_import(importPath) {
            if (importPath.startsWith("@/")) {
                return importPath.replace("@/", "frontend/");
            }
            if (importPath.startsWith(".") || importPath.startsWith("/")) {
                const dirname = path.dirname(filename);
                const absolutePath = path.resolve(dirname, importPath);
                return path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
            }
            return importPath;
        }

        function check_import(node, importSource) {
            if (!importSource || typeof importSource !== "string") return;
            // Skip 3rd party libraries directly
            if (!importSource.startsWith(".") && !importSource.startsWith("/") && !importSource.startsWith("@/")) {
                return;
            }

            const resolved = get_resolved_import(importSource);

            // 1. Non-UI files must NEVER import modules from UI-related directories
            if (!isUiFile) {
                const matchedUi = UI_DIRS.find(dir => resolved.startsWith(dir));
                if (matchedUi) {
                    context.report({
                        node,
                        messageId: "noUiInNonUi",
                        data: {
                            file: relativeFile,
                            imported: matchedUi
                        }
                    });
                }
            }

            // 2. frontend/components/ must not depend on frontend/blocks/ or frontend/app/
            if (relativeFile.startsWith("frontend/components/")) {
                if (resolved.startsWith("frontend/blocks/") || resolved.startsWith("frontend/app/")) {
                    context.report({
                        node,
                        messageId: "noComponentsToBlocks"
                    });
                }
            }

            // 3. frontend/infra/ must not depend on frontend/core/
            if (relativeFile.startsWith("frontend/infra/")) {
                if (resolved.startsWith("frontend/core/")) {
                    context.report({
                        node,
                        messageId: "noCoreInInfra"
                    });
                }
            }
        }

        return {
            ImportDeclaration(node) {
                if (node.source) {
                    check_import(node, node.source.value);
                }
            },
            ImportExpression(node) {
                if (node.source && node.source.type === "Literal" && typeof node.source.value === "string") {
                    check_import(node, node.source.value);
                }
            }
        };
    }
};

const is_pascal_case = str => /^[A-Z][a-zA-Z0-9]*$/.test(str);
const is_camel_case = str => /^[a-z][a-zA-Z0-9]*$/.test(str);
const is_snake_case = str => /^_?[a-z0-9]+(_[a-z0-9]+)*_?$/.test(str);
const IGNORED_NAMES = new Set(["default", "React", "JSX", "HTML", "URL", "JSON", "UI"]);

const namingConventionsRule = {
    meta: {
        type: "suggestion",
        docs: {
            description: "Enforce naming conventions from AGENTS.md"
        },
        messages: {
            invalidHook: "React hook '{{name}}' must be camelCase.",
            invalidType: "Type/Interface/Class/Enum '{{name}}' must be PascalCase.",
            invalidFunc: "Function/Method '{{name}}' must be snake_case (except React components/hooks).",
            invalidVar: "Variable '{{name}}' must be snake_case or SCREAMING_SNAKE_CASE (except PascalCase React components/Context/Refs)."
        }
    },
    create(context) {
        return {
            TSTypeAliasDeclaration(node) {
                if (!node.id || !node.id.name) return;
                const name = node.id.name;
                if (!is_pascal_case(name)) {
                    context.report({ node: node.id, messageId: "invalidType", data: { name } });
                }
            },
            TSInterfaceDeclaration(node) {
                if (!node.id || !node.id.name) return;
                const name = node.id.name;
                if (!is_pascal_case(name)) {
                    context.report({ node: node.id, messageId: "invalidType", data: { name } });
                }
            },
            ClassDeclaration(node) {
                if (node.id && node.id.name) {
                    const name = node.id.name;
                    if (!is_pascal_case(name)) {
                        context.report({ node: node.id, messageId: "invalidType", data: { name } });
                    }
                }
            },
            TSEnumDeclaration(node) {
                if (!node.id || !node.id.name) return;
                const name = node.id.name;
                if (!is_pascal_case(name)) {
                    context.report({ node: node.id, messageId: "invalidType", data: { name } });
                }
            },
            FunctionDeclaration(node) {
                if (!node.id || !node.id.name) return;
                const name = node.id.name;
                if (IGNORED_NAMES.has(name)) return;

                if (/^use[A-Z]/.test(name)) {
                    if (!is_camel_case(name)) {
                        context.report({ node: node.id, messageId: "invalidHook", data: { name } });
                    }
                } else if (is_pascal_case(name)) {
                    // React Component, allowed
                } else {
                    if (!is_snake_case(name)) {
                        context.report({ node: node.id, messageId: "invalidFunc", data: { name } });
                    }
                }
            },
            VariableDeclarator(node) {
                if (!node.id || node.id.type !== "Identifier") return;
                const name = node.id.name;
                if (IGNORED_NAMES.has(name)) return;

                if (/^use[A-Z]/.test(name)) {
                    if (!is_camel_case(name)) {
                        context.report({ node: node.id, messageId: "invalidHook", data: { name } });
                    }
                } else if (node.init && (node.init.type === "ArrowFunctionExpression" || node.init.type === "FunctionExpression")) {
                    if (is_pascal_case(name)) {
                        // React Component, allowed
                    } else if (!is_snake_case(name)) {
                        context.report({ node: node.id, messageId: "invalidFunc", data: { name } });
                    }
                }
            }
        };
    }
};

const noSyncSetStateInEffectRule = {
    meta: {
        type: "suggestion",
        docs: {
            description: "Disallow synchronous setState calls inside useEffect with non-empty dependencies"
        },
        messages: {
            syncSetState: "Do not call setState ('{{name}}') synchronously inside a useEffect with dependencies. Move this state synchronization logic to the render phase or trigger it via event handlers."
        }
    },
    create(context) {
        return {
            CallExpression(node) {
                if (!node.callee || node.callee.type !== "Identifier" || node.callee.name !== "useEffect") {
                    return;
                }

                const deps = node.arguments && node.arguments[1];
                if (!deps || deps.type !== "ArrayExpression" || !deps.elements || deps.elements.length === 0) {
                    return;
                }

                const effectCallback = node.arguments[0];
                if (!effectCallback || (effectCallback.type !== "ArrowFunctionExpression" && effectCallback.type !== "FunctionExpression")) {
                    return;
                }

                function check_block(blockNode) {
                    if (!blockNode) return;
                    const statements = blockNode.type === "BlockStatement" ? blockNode.body : [blockNode];
                    if (!statements) return;

                    for (const stmt of statements) {
                        if (!stmt) continue;
                        if (stmt.type === "ExpressionStatement") {
                            const expr = stmt.expression;
                            if (expr && expr.type === "CallExpression") {
                                check_call(expr);
                            }
                        } else if (stmt.type === "IfStatement") {
                            check_block(stmt.consequent);
                            check_block(stmt.alternate);
                        } else if (stmt.type === "ForStatement" || stmt.type === "ForInStatement" || stmt.type === "ForOfStatement" || stmt.type === "WhileStatement" || stmt.type === "DoWhileStatement") {
                            check_block(stmt.body);
                        } else if (stmt.type === "SwitchStatement") {
                            if (stmt.cases) {
                                for (const caseNode of stmt.cases) {
                                    if (caseNode.consequent) {
                                        for (const subStmt of caseNode.consequent) {
                                            check_block(subStmt);
                                        }
                                    }
                                }
                            }
                        } else if (stmt.type === "BlockStatement") {
                            check_block(stmt);
                        }
                    }
                }

                function check_call(callNode) {
                    if (callNode.callee && callNode.callee.type === "Identifier") {
                        const name = callNode.callee.name;
                        if (/^set[A-Z_]/u.test(name)) {
                            context.report({
                                node: callNode,
                                messageId: "syncSetState",
                                data: { name }
                            });
                        }
                    }
                }

                if (effectCallback.body) {
                    if (effectCallback.body.type === "BlockStatement") {
                        check_block(effectCallback.body);
                    } else if (effectCallback.body.type === "CallExpression") {
                        check_call(effectCallback.body);
                    }
                }
            }
        };
    }
};

const plugin = {
    meta: {
        name: "local"
    },
    rules: {
        "jsx-text-indent": jsxTextIndentRule,
        "no-emojis": noEmojisRule,
        "no-inline-svgs": noInlineSvgsRule,
        "layering-restrictions": layeringRestrictionsRule,
        "naming-conventions": namingConventionsRule,
        "no-sync-set-state-in-effect": noSyncSetStateInEffectRule
    }
};

export default plugin;
