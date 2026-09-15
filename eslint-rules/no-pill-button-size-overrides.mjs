const dimensionClass =
  /^(?:.*:)?!?(?:(?:min-|max-)?h|size|p[trblxyse]?|gap(?:-[xy])?)-/;

function overridesSize(node, visitorKeys) {
  if (!node) return false;
  const text =
    node.type === "Literal"
      ? node.value
      : node.type === "TemplateElement"
        ? node.value.raw
        : null;
  if (
    typeof text === "string" &&
    text.split(/\s+/).some((token) => dimensionClass.test(token))
  ) {
    return true;
  }
  if (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    ["typeStyle", "redactionTypeStyle"].includes(node.callee.name)
  ) {
    return true;
  }
  return (visitorKeys[node.type] ?? []).some((key) => {
    const child = node[key];
    return Array.isArray(child)
      ? child.some((item) => overridesSize(item, visitorKeys))
      : overridesSize(child, visitorKeys);
  });
}

const spotPillButtonPlugin = {
  rules: {
    "no-pill-button-size-overrides": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          size: "PillButton owns height, padding, gap, and typography. Use size or roomyOnMobile instead of className overrides.",
        },
      },
      create(context) {
        const names = new Set();
        return {
          ImportDeclaration(node) {
            if (!node.source.value.endsWith("/pill-button")) return;
            for (const specifier of node.specifiers) {
              if (
                specifier.type === "ImportSpecifier" &&
                specifier.imported.name === "PillButton"
              ) {
                names.add(specifier.local.name);
              }
            }
          },
          JSXOpeningElement(node) {
            if (
              node.name.type !== "JSXIdentifier" ||
              !names.has(node.name.name)
            )
              return;
            const className = node.attributes.find(
              (attribute) =>
                attribute.type === "JSXAttribute" &&
                attribute.name.name === "className",
            );
            if (
              className &&
              overridesSize(className.value, context.sourceCode.visitorKeys)
            ) {
              context.report({ node: className, messageId: "size" });
            }
          },
        };
      },
    },
  },
};

export default spotPillButtonPlugin;
