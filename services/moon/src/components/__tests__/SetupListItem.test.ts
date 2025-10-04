import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SetupListItem from '../SetupListItem.vue';

const stubs = {
  'v-list-item': {
    template:
      '<div data-testid="item" @click="$emit(\'click\', $event)"><slot name="prepend"></slot><slot></slot></div>',
  },
  'v-checkbox-btn': {
    props: ['modelValue', 'disabled'],
    template:
      '<input data-testid="checkbox" type="checkbox" :checked="modelValue" :disabled="disabled" @click.stop="$emit(\'click\', $event)" />',
  },
  'v-chip': {
    template: '<span class="chip"><slot /></span>',
  },
  'v-icon': {
    template: '<span class="icon"><slot /></span>',
  },
  'v-divider': {
    template: '<hr />',
  },
};

describe('SetupListItem', () => {
  it('emits toggle when the item is clicked', async () => {
    const wrapper = mount(SetupListItem, {
      props: {
        service: { name: 'noona-sage', category: 'core' },
        selected: false,
      },
      global: { stubs },
    });

    await wrapper.find('[data-testid="item"]').trigger('click');
    const events = wrapper.emitted('toggle');
    expect(events).toBeTruthy();
    expect(events?.[0]).toEqual(['noona-sage']);
  });

  it('prevents toggling when the service is required', async () => {
    const wrapper = mount(SetupListItem, {
      props: {
        service: { name: 'noona-vault', category: 'core', required: true },
        selected: true,
      },
      global: { stubs },
    });

    await wrapper.find('[data-testid="item"]').trigger('click');
    expect(wrapper.emitted('toggle')).toBeUndefined();
    expect(wrapper.html()).toContain('Required');

    const checkbox = wrapper.find('[data-testid="checkbox"]');
    expect(checkbox.attributes('disabled')).toBeDefined();
  });
});
