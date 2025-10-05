import {mount, VueWrapper} from '@vue/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../../utils/ravenClient.js', () => {
  return {
    fetchLibrary: vi.fn(),
    fetchDownloadStatuses: vi.fn(),
    searchTitles: vi.fn(),
    startDownload: vi.fn(),
  };
});

import RavenPage from '../Raven.vue';
import {
  fetchLibrary,
  fetchDownloadStatuses,
  searchTitles,
  startDownload,
} from '../../utils/ravenClient.js';

type MockedFn = ReturnType<typeof vi.fn>;

const fetchLibraryMock = fetchLibrary as unknown as MockedFn;
const fetchDownloadStatusesMock = fetchDownloadStatuses as unknown as MockedFn;
const searchTitlesMock = searchTitles as unknown as MockedFn;
const startDownloadMock = startDownload as unknown as MockedFn;

const flushAsync = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const stubs = {
  Header: {template: '<div><slot /></div>'},
  'v-container': {template: '<div><slot /></div>'},
  'v-row': {template: '<div><slot /></div>'},
  'v-col': {template: '<div><slot /></div>'},
  'v-card': {template: '<div><slot /></div>'},
  'v-card-title': {template: '<div><slot /></div>'},
  'v-card-subtitle': {template: '<div><slot /></div>'},
  'v-card-text': {template: '<div><slot /></div>'},
  'v-card-actions': {template: '<div><slot /></div>'},
  'v-btn': {
    props: ['disabled'],
    emits: ['click'],
    template:
      '<button v-bind="$attrs" :disabled="disabled" @click="$emit(\'click\', $event)"><slot /></button>',
  },
  'v-icon': {template: '<i><slot /></i>'},
  'v-alert': {template: '<div><slot /></div>'},
  'v-progress-linear': {
    props: ['modelValue'],
    template: '<progress v-bind="$attrs" :value="modelValue" max="100"><slot /></progress>',
  },
  'v-dialog': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div v-if="modelValue" v-bind="$attrs"><slot /><slot name="actions" /></div>',
  },
  'v-text-field': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  'v-form': {
    emits: ['submit'],
    template: '<form v-bind="$attrs" @submit.prevent="$emit(\'submit\', $event)"><slot /></form>',
  },
  'v-img': {template: '<img />'},
  'v-chip': {template: '<span><slot /></slot></span>'},
  'v-divider': {template: '<hr />'},
};

const mountPage = async () => {
  const wrapper = mount(RavenPage, {
    global: {stubs},
  });

  await flushAsync();
  await wrapper.vm.$nextTick();
  return wrapper;
};

describe('Raven library page', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    fetchLibraryMock.mockReset();
    fetchDownloadStatusesMock.mockReset();
    searchTitlesMock.mockReset();
    startDownloadMock.mockReset();
    fetchLibraryMock.mockResolvedValue({library: []});
    fetchDownloadStatusesMock.mockResolvedValue({downloads: []});
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it('renders downloaded series cards', async () => {
    fetchLibraryMock.mockResolvedValue({
      library: [
        {id: 'series-1', title: 'Series One', description: 'A telemetry story'},
      ],
    });

    wrapper = await mountPage();
    await flushAsync();

    expect(wrapper.findAll('[data-test="raven-library-card"]').length).toBe(1);
    expect(wrapper.text()).toContain('Series One');
  });

  it('shows an empty state when the library has no entries', async () => {
    fetchLibraryMock.mockResolvedValue({library: []});

    wrapper = await mountPage();
    await flushAsync();

    expect(wrapper.find('[data-test="library-empty"]').exists()).toBe(true);
  });

  it('handles dialog search and download confirmation', async () => {
    searchTitlesMock.mockResolvedValue({
      results: [
        {
          id: 'search-1',
          title: 'Raven Saga',
          options: [
            {label: 'Complete series'},
            {label: 'Volume 1'},
          ],
        },
      ],
    });

    startDownloadMock.mockResolvedValue({status: 'queued'});

    wrapper = await mountPage();
    await flushAsync();

    await wrapper.get('[data-test="open-add-dialog"]').trigger('click');
    const input = wrapper.get('input[data-test="search-query"]');
    await input.setValue('raven');
    await wrapper.get('[data-test="search-form"]').trigger('submit');
    await flushAsync();

    expect(searchTitles).toHaveBeenCalledWith('raven');

    const options = wrapper.findAll('[data-test="search-option"]');
    expect(options.length).toBe(2);

    await options[1].trigger('click');
    const confirm = wrapper.get('[data-test="confirm-download"]');
    expect(confirm.attributes('disabled')).toBeUndefined();

    await confirm.trigger('click');
    await flushAsync();

    expect(startDownload).toHaveBeenCalledWith({searchId: 'search-1', optionIndex: 1});
    expect(wrapper.find('[data-test="add-dialog"]').exists()).toBe(false);
  });

  it('shows an error when the library request fails', async () => {
    fetchLibraryMock.mockRejectedValue(new Error('server down'));

    wrapper = await mountPage();
    await flushAsync();

    expect(wrapper.find('[data-test="library-error"]').text()).toContain('server down');
  });

  it('renders download progress from status polling', async () => {
    fetchLibraryMock.mockResolvedValue({
      library: [{id: 'series-1', title: 'Series One'}],
    });

    fetchDownloadStatusesMock.mockResolvedValue({
      downloads: [
        {
          id: 'download-1',
          libraryId: 'series-1',
          title: 'Series One',
          state: 'downloading',
          progress: 40,
          message: 'Downloading',
        },
      ],
    });

    wrapper = await mountPage();
    await flushAsync();

    expect(wrapper.find('[data-test="download-progress"]').exists()).toBe(true);
  });

  it('shows a search error when the search endpoint fails', async () => {
    searchTitlesMock.mockRejectedValue(new Error('search failed'));

    wrapper = await mountPage();
    await flushAsync();

    await wrapper.get('[data-test="open-add-dialog"]').trigger('click');
    const input = wrapper.get('input[data-test="search-query"]');
    await input.setValue('issue');
    await wrapper.get('[data-test="search-form"]').trigger('submit');
    await flushAsync();

    expect(wrapper.find('[data-test="search-error"]').text()).toContain('search failed');
  });

  it('shows a download error when starting the download fails', async () => {
    searchTitlesMock.mockResolvedValue({
      results: [
        {
          id: 'search-2',
          title: 'Dark Flight',
          options: [{label: 'Complete'}],
        },
      ],
    });

    startDownloadMock.mockRejectedValue(new Error('download failed'));

    wrapper = await mountPage();
    await flushAsync();

    await wrapper.get('[data-test="open-add-dialog"]').trigger('click');
    const input = wrapper.get('input[data-test="search-query"]');
    await input.setValue('dark');
    await wrapper.get('[data-test="search-form"]').trigger('submit');
    await flushAsync();

    await wrapper.get('[data-test="search-option"]').trigger('click');
    await wrapper.get('[data-test="confirm-download"]').trigger('click');
    await flushAsync();

    expect(wrapper.find('[data-test="download-error"]').text()).toContain('download failed');
  });

  it('refreshes the library when downloads complete', async () => {
    fetchLibraryMock
      .mockResolvedValueOnce({library: []})
      .mockResolvedValueOnce({library: [{id: 'series-2', title: 'Completed'}]})
      .mockResolvedValue({library: [{id: 'series-2', title: 'Completed'}]});

    fetchDownloadStatusesMock.mockResolvedValue({
      downloads: [
        {id: 'download-2', libraryId: 'series-2', title: 'Completed', state: 'completed'},
      ],
    });

    wrapper = await mountPage();
    await flushAsync();

    expect(fetchLibrary).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('[data-test="raven-library-card"]').length).toBe(1);
  });
});
