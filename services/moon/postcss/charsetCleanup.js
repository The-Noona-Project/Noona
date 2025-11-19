export default function charsetCleanupPlugin() {
  return {
    postcssPlugin: 'charset-cleanup-plugin',
    AtRule(atRule) {
      if (atRule.name && atRule.name.toLowerCase() === 'charset') {
        atRule.remove();
      }
    },
  };
}

charsetCleanupPlugin.postcss = true;
