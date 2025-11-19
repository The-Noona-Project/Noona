const AMPERSAND_MODIFIER_REGEX = /&(--[A-Za-z0-9_-]+)/g;

function replaceAmpersandModifiers(selector) {
  return selector.replace(AMPERSAND_MODIFIER_REGEX, (_match, modifier) => `:is(&.${modifier})`);
}

export default function ampersandModifiersPlugin() {
  return {
    postcssPlugin: 'ampersand-modifiers-plugin',
    Rule(rule) {
      if (!rule.selectors) {
        return;
      }

      let mutated = false;
      const nextSelectors = rule.selectors.map((selector) => {
        if (!selector.includes('&--')) {
          return selector;
        }

        mutated = true;
        AMPERSAND_MODIFIER_REGEX.lastIndex = 0;
        return replaceAmpersandModifiers(selector);
      });

      if (mutated) {
        rule.selectors = nextSelectors;
      }
    },
  };
}

ampersandModifiersPlugin.postcss = true;
