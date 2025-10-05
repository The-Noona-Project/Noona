<script setup>
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
import Header from '../components/Header.vue';
import RavenLibraryGrid from '../components/raven/RavenLibraryGrid.vue';
import {
  fetchDownloadStatuses,
  fetchLibrary,
  searchTitles,
  startDownload,
} from '../utils/ravenClient.js';

const library = ref([]);
const libraryLoading = ref(false);
const libraryError = ref('');

const downloads = ref([]);
const downloadsError = ref('');

const isDialogOpen = ref(false);
const searchQuery = ref('');
const searchResults = ref([]);
const searchLoading = ref(false);
const searchError = ref('');
const downloadError = ref('');
const downloadLoading = ref(false);
const selectedOption = ref(null);

const POLL_INTERVAL = 5000;
let pollHandle = null;

const completedDownloads = new Set();

const resetDialogState = () => {
  searchQuery.value = '';
  searchResults.value = [];
  searchError.value = '';
  downloadError.value = '';
  selectedOption.value = null;
  downloadLoading.value = false;
};

const openAddDialog = () => {
  resetDialogState();
  isDialogOpen.value = true;
};

const closeAddDialog = () => {
  isDialogOpen.value = false;
  resetDialogState();
};

const parseLibraryResponse = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.library)) return payload.library;
  if (Array.isArray(payload.series)) return payload.series;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
};

const parseDownloadsResponse = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.downloads)) return payload.downloads;
  if (Array.isArray(payload.statuses)) return payload.statuses;
  return [];
};

const statusKey = (status) => {
  if (!status) return null;
  return (
    status.libraryId ??
    status.id ??
    status.searchId ??
    status.seriesId ??
    status.title ??
    null
  );
};

const loadLibrary = async () => {
  libraryLoading.value = true;
  libraryError.value = '';
  try {
    const payload = await fetchLibrary();
    library.value = parseLibraryResponse(payload);
  } catch (error) {
    libraryError.value = error instanceof Error ? error.message : 'Failed to load library.';
  } finally {
    libraryLoading.value = false;
  }
};

const refreshDownloads = async () => {
  try {
    downloadsError.value = '';
    const payload = await fetchDownloadStatuses();
    const list = parseDownloadsResponse(payload);
    downloads.value = list;

    let shouldRefreshLibrary = false;
    list.forEach((status) => {
      const key = statusKey(status);
      if (status?.state === 'completed' && key && !completedDownloads.has(key)) {
        completedDownloads.add(key);
        shouldRefreshLibrary = true;
      }
    });

    if (shouldRefreshLibrary) {
      await loadLibrary();
    }
  } catch (error) {
    downloadsError.value =
      error instanceof Error ? error.message : 'Failed to load download status.';
  }
};

const activeDownloads = computed(() => downloads.value ?? []);

const performSearch = async () => {
  const query = searchQuery.value.trim();
  if (!query) {
    searchError.value = 'Please enter a search term.';
    return;
  }

  searchLoading.value = true;
  searchError.value = '';
  downloadError.value = '';
  searchResults.value = [];
  selectedOption.value = null;

  try {
    const payload = await searchTitles(query);
    const results = payload?.results ?? payload?.options ?? payload;
    searchResults.value = Array.isArray(results) ? results : [];
    if (!searchResults.value.length) {
      searchError.value = 'No matches found.';
    }
  } catch (error) {
    searchError.value = error instanceof Error ? error.message : 'Failed to search titles.';
    searchResults.value = [];
  } finally {
    searchLoading.value = false;
  }
};

const selectOption = (searchId, optionIndex) => {
  selectedOption.value = {searchId, optionIndex};
  downloadError.value = '';
};

const isSelected = (result, optionIndex) => {
  const id = result?.id ?? result?.searchId;
  return (
    selectedOption.value?.searchId === id &&
    selectedOption.value?.optionIndex === optionIndex
  );
};

const canConfirmDownload = computed(
  () => Boolean(selectedOption.value) && !downloadLoading.value,
);

const startDownloadFlow = async () => {
  if (!selectedOption.value) return;

  downloadLoading.value = true;
  downloadError.value = '';

  try {
    await startDownload({
      searchId: selectedOption.value.searchId,
      optionIndex: selectedOption.value.optionIndex,
    });
    closeAddDialog();
    await refreshDownloads();
  } catch (error) {
    downloadError.value =
      error instanceof Error ? error.message : 'Failed to start download.';
  } finally {
    downloadLoading.value = false;
  }
};

const activeSearchSelectionLabel = computed(() => {
  if (!selectedOption.value) return '';
  const {searchId, optionIndex} = selectedOption.value;
  const result = searchResults.value.find(
    (entry) => (entry?.id ?? entry?.searchId) === searchId,
  );
  if (!result) return '';
  const option = result.options?.[optionIndex];
  const optionLabel = option?.label ?? option?.name ?? `Option ${optionIndex + 1}`;
  const title = result.title ?? result.name ?? 'Selected title';
  return `${title} – ${optionLabel}`;
});

onMounted(() => {
  loadLibrary();
  refreshDownloads();
  pollHandle = setInterval(() => {
    refreshDownloads();
  }, POLL_INTERVAL);
});

onBeforeUnmount(() => {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
});
</script>

<template>
  <Header>
    <v-container class="py-12">
      <v-row class="align-center mb-6">
        <v-col cols="12" md="8" class="d-flex justify-space-between flex-column flex-md-row">
          <div class="mb-4 mb-md-0">
            <h1 class="text-h4 font-weight-medium mb-1">Raven Library</h1>
            <p class="text-body-1 text-medium-emphasis mb-0">
              Monitor downloads and manage your telemetry series.
            </p>
          </div>
          <v-btn
              color="primary"
              prepend-icon="mdi-plus"
              class="align-self-md-end"
              data-test="open-add-dialog"
              @click="openAddDialog"
          >
            Add new title
          </v-btn>
        </v-col>
      </v-row>

      <v-row v-if="libraryError" class="mb-4">
        <v-col cols="12">
          <v-alert
              type="error"
              variant="tonal"
              data-test="library-error"
          >
            {{ libraryError }}
          </v-alert>
        </v-col>
      </v-row>

      <v-row v-if="downloadsError" class="mb-4">
        <v-col cols="12">
          <v-alert
              type="warning"
              variant="tonal"
              data-test="downloads-error"
          >
            {{ downloadsError }}
          </v-alert>
        </v-col>
      </v-row>

      <v-row v-if="libraryLoading" class="mb-6">
        <v-col cols="12">
          <v-progress-linear indeterminate color="primary" />
        </v-col>
      </v-row>

      <div
          v-if="!libraryLoading && !library.length"
          class="text-center py-16 text-medium-emphasis"
          data-test="library-empty"
      >
        <v-icon color="primary" size="64" class="mb-4">mdi-crow</v-icon>
        <div class="text-h5 mb-2">Your Raven library is empty.</div>
        <div class="text-body-1">
          Start a search to download your first telemetry series.
        </div>
      </div>

      <RavenLibraryGrid
          v-else
          :items="library"
          :statuses="activeDownloads"
      />
    </v-container>

    <v-dialog v-model="isDialogOpen" max-width="640">
      <v-card data-test="add-dialog">
        <v-card-title class="text-h5">Add a new title</v-card-title>
        <v-card-text>
          <v-form data-test="search-form" @submit.prevent="performSearch">
            <v-text-field
                v-model="searchQuery"
                label="Search the Raven index"
                prepend-inner-icon="mdi-magnify"
                clearable
                data-test="search-query"
            />
            <v-btn
                type="submit"
                color="primary"
                class="mt-2"
                block
                :loading="searchLoading"
                :disabled="searchLoading"
                data-test="submit-search"
            >
              Search
            </v-btn>
          </v-form>

          <v-progress-linear
              v-if="searchLoading"
              class="my-4"
              indeterminate
              color="primary"
          />

          <v-alert
              v-if="searchError"
              type="error"
              variant="tonal"
              class="mt-4"
              data-test="search-error"
          >
            {{ searchError }}
          </v-alert>

          <div v-if="searchResults.length" class="mt-4" data-test="search-results">
            <div
                v-for="result in searchResults"
                :key="result.id ?? result.searchId"
                class="mb-4"
                data-test="search-result"
            >
              <div class="text-subtitle-1 font-weight-medium">
                {{ result.title ?? result.name }}
              </div>
              <div v-if="result.description" class="text-body-2 text-medium-emphasis mb-2">
                {{ result.description }}
              </div>
              <div class="d-flex flex-wrap gap-2">
                <v-btn
                    v-for="(option, optionIndex) in result.options ?? []"
                    :key="optionIndex"
                    variant="outlined"
                    :color="isSelected(result, optionIndex) ? 'primary' : undefined"
                    data-test="search-option"
                    @click="selectOption(result.id ?? result.searchId, optionIndex)"
                >
                  {{ option?.label ?? option?.name ?? `Option ${optionIndex + 1}` }}
                </v-btn>
              </div>
            </div>
          </div>

          <v-alert
              v-if="downloadError"
              type="error"
              variant="tonal"
              data-test="download-error"
          >
            {{ downloadError }}
          </v-alert>

          <v-alert
              v-if="activeSearchSelectionLabel"
              type="info"
              variant="tonal"
              class="mt-4"
              data-test="selected-option"
          >
            {{ activeSearchSelectionLabel }}
          </v-alert>
        </v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="closeAddDialog">Cancel</v-btn>
          <v-btn
              color="primary"
              :disabled="!canConfirmDownload"
              :loading="downloadLoading"
              data-test="confirm-download"
              @click="startDownloadFlow"
          >
            Confirm download
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </Header>
</template>
