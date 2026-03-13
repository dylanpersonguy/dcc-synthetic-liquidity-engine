import type { IVenueAdapter, VenueType } from '@dcc/types';

// ============================================================================
// VenueRegistry — maintains the set of active venue adapters
// ============================================================================

export class VenueRegistry {
  private adapters = new Map<string, IVenueAdapter>();

  register(adapter: IVenueAdapter): void {
    this.adapters.set(adapter.venueId, adapter);
  }

  unregister(venueId: string): void {
    this.adapters.delete(venueId);
  }

  get(venueId: string): IVenueAdapter | undefined {
    return this.adapters.get(venueId);
  }

  getAll(): IVenueAdapter[] {
    return Array.from(this.adapters.values());
  }

  getByType(venueType: VenueType): IVenueAdapter[] {
    return this.getAll().filter((a) => a.venueType === venueType);
  }

  has(venueId: string): boolean {
    return this.adapters.has(venueId);
  }
}
