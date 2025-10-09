import React, { useMemo } from 'react';
import { SimpleGrid } from '@chakra-ui/react';
import RavenLibraryCard from './RavenLibraryCard.jsx';

function itemKey(item, index) {
  const candidate = item?.id ?? item?.slug ?? item?.seriesId ?? item?.title;
  return candidate != null ? String(candidate) : `item-${index}`;
}

function statusKey(status) {
  if (!status) {
    return null;
  }
  const key =
    status.libraryId ?? status.id ?? status.searchId ?? status.seriesId ?? status.title ?? null;
  return key != null ? String(key) : null;
}

export default function RavenLibraryGrid({ items = [], statuses = [] }) {
  const statusMap = useMemo(() => {
    const map = new Map();
    statuses.forEach((status) => {
      const key = statusKey(status);
      if (key !== null) {
        map.set(key, status);
      }
    });
    return map;
  }, [statuses]);

  const combinedEntries = useMemo(() => {
    const seen = new Set();
    const entries = [];

    items.forEach((item, index) => {
      const key = itemKey(item, index);
      const normalizedKey = key != null ? String(key) : `item-${index}`;
      const status = statusMap.get(normalizedKey) ?? null;
      entries.push({ key: normalizedKey, item, status });
      seen.add(normalizedKey);
    });

    statusMap.forEach((status, key) => {
      if (seen.has(key)) {
        return;
      }
      entries.push({
        key,
        item: {
          id: key,
          title: status.title ?? 'Processing download',
          description: status.message ?? 'This title is being prepared.',
        },
        status,
      });
    });

    return entries;
  }, [items, statusMap]);

  return (
    <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4}>
      {combinedEntries.map((entry) => (
        <RavenLibraryCard key={entry.key} item={entry.item} status={entry.status} />
      ))}
    </SimpleGrid>
  );
}
