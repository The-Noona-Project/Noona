export function isServiceRequired(service) {
  return Boolean(service && service.required === true);
}

function normalizeName(service) {
  if (!service) return '';
  const name = typeof service.name === 'string' ? service.name.trim() : '';
  return name;
}

export function mergeRequiredSelections(services = [], previousSelection = []) {
  const selectableNames = new Set();
  const requiredNames = [];
  const requiredSet = new Set();

  for (const service of services) {
    const name = normalizeName(service);
    if (!name || service?.installed === true) {
      continue;
    }

    selectableNames.add(name);

    if (isServiceRequired(service) && !requiredSet.has(name)) {
      requiredNames.push(name);
      requiredSet.add(name);
    }
  }

  const merged = [...requiredNames];
  const mergedSet = new Set(requiredNames);

  for (const candidate of Array.isArray(previousSelection) ? previousSelection : []) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const trimmed = candidate.trim();
    if (!trimmed || mergedSet.has(trimmed) || !selectableNames.has(trimmed)) {
      continue;
    }

    merged.push(trimmed);
    mergedSet.add(trimmed);
  }

  return merged;
}
