import { useEffect, useSyncExternalStore } from 'react';
import { roomCatalogStore } from '../utils/roomCatalog';

export function useRoomCatalog() {
  const catalog = useSyncExternalStore(roomCatalogStore.subscribe, roomCatalogStore.getSnapshot);
  useEffect(() => { roomCatalogStore.loadAll(); }, []);
  return catalog;
}
