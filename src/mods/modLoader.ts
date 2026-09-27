import { globalSchemaValidator } from './schemaValidator.js';
import { globalCardRegistry } from './cardRegistry.js';
import { globalLocalization } from './localization.js';
import { ModManifest, CardDefinition, BlueprintDefinition, PackDefinition } from './types.js';

export interface ModPackageData {
  manifest: ModManifest;
  localizationTsv?: string;
  cards: Record<string, unknown>;
  blueprints: Record<string, unknown>;
  packs: Record<string, unknown>;
}

export class ModLoader {
  /**
   * Ingests a raw mod package data object, validates schemas, and registers all content.
   */
  static ingestMod(data: ModPackageData): { success: boolean; errors: string[] } {
    const errors: string[] = [];

    // 1. Validate manifest
    const manifestRes = globalSchemaValidator.validateManifestDefinition(data.manifest);
    if (!manifestRes.valid) {
      errors.push(`[${data.manifest?.id || 'Unknown'}] Invalid manifest: ${manifestRes.errors?.join(', ')}`);
      return { success: false, errors };
    }

    const modId = manifestRes.data!.id;

    // 2. Ingest Localization
    if (data.localizationTsv) {
      globalLocalization.loadFromTsv(data.localizationTsv);
    }

    // 3. Ingest Cards
    for (const [key, rawCard] of Object.entries(data.cards)) {
      const cardRes = globalSchemaValidator.validateCardDefinition(rawCard);
      if (!cardRes.valid) {
        errors.push(`[${modId}] Card '${key}' validation failed: ${cardRes.errors?.join(', ')}`);
        continue;
      }
      globalCardRegistry.registerCard(cardRes.data as CardDefinition);
    }

    // 4. Ingest Blueprints
    for (const [key, rawBp] of Object.entries(data.blueprints)) {
      const bpRes = globalSchemaValidator.validateBlueprintDefinition(rawBp);
      if (!bpRes.valid) {
        errors.push(`[${modId}] Blueprint '${key}' validation failed: ${bpRes.errors?.join(', ')}`);
        continue;
      }
      globalCardRegistry.registerBlueprint(bpRes.data as BlueprintDefinition);
    }

    // 5. Ingest Packs
    for (const [key, rawPack] of Object.entries(data.packs)) {
      const packRes = globalSchemaValidator.validatePackDefinition(rawPack);
      if (!packRes.valid) {
        errors.push(`[${modId}] Pack '${key}' validation failed: ${packRes.errors?.join(', ')}`);
        continue;
      }
      globalCardRegistry.registerPack(packRes.data as PackDefinition);
    }

    const success = errors.length === 0;
    return { success, errors };
  }

  /**
   * Discovers and ingests all mods located under `/Mods` using Vite's compile-time globbing.
   */
  static async loadAllViteMods(): Promise<{ loadedMods: string[]; errors: string[] }> {
    const loadedMods: string[] = [];
    const allErrors: string[] = [];

    // Dynamically query all mod files in the /Mods directory
    const manifestFiles = import.meta.glob('/Mods/*/manifest.json', { eager: true });
    const cardFiles = import.meta.glob('/Mods/*/Cards/*.json', { eager: true });
    const blueprintFiles = import.meta.glob('/Mods/*/Blueprints/*.json', { eager: true });
    const packFiles = import.meta.glob('/Mods/*/Packs/*.json', { eager: true });
    const localizationFiles = import.meta.glob('/Mods/*/localization.tsv', { eager: true, query: '?raw', import: 'default' });

    // Group files by mod folder name (e.g., 'Core')
    const modFolders = new Set<string>();
    for (const path of Object.keys(manifestFiles)) {
      const parts = path.split('/');
      // path looks like /Mods/Core/manifest.json -> parts = ['', 'Mods', 'Core', 'manifest.json']
      if (parts[2]) {
        modFolders.add(parts[2]);
      }
    }

    // Collect mod packages
    const packages: ModPackageData[] = [];

    for (const folder of modFolders) {
      const manifestPath = `/Mods/${folder}/manifest.json`;
      const manifestModule = manifestFiles[manifestPath] as any;
      const manifest = manifestModule?.default || manifestModule;

      if (!manifest) {
        allErrors.push(`Missing manifest in mod folder '${folder}'`);
        continue;
      }

      const cards: Record<string, unknown> = {};
      const cardPrefix = `/Mods/${folder}/Cards/`;
      for (const [path, mod] of Object.entries(cardFiles)) {
        if (path.startsWith(cardPrefix)) {
          const cardData = (mod as any)?.default || mod;
          cards[path] = cardData;
        }
      }

      const blueprints: Record<string, unknown> = {};
      const bpPrefix = `/Mods/${folder}/Blueprints/`;
      for (const [path, mod] of Object.entries(blueprintFiles)) {
        if (path.startsWith(bpPrefix)) {
          const bpData = (mod as any)?.default || mod;
          blueprints[path] = bpData;
        }
      }

      const packs: Record<string, unknown> = {};
      const packPrefix = `/Mods/${folder}/Packs/`;
      for (const [path, mod] of Object.entries(packFiles)) {
        if (path.startsWith(packPrefix)) {
          const packData = (mod as any)?.default || mod;
          packs[path] = packData;
        }
      }

      const locPath = `/Mods/${folder}/localization.tsv`;
      const localizationTsv = localizationFiles[locPath] as string | undefined;

      packages.push({
        manifest,
        localizationTsv,
        cards,
        blueprints,
        packs,
      });
    }

    // Sort by priority (lower loads first)
    packages.sort((a, b) => (a.manifest.priority ?? 100) - (b.manifest.priority ?? 100));

    for (const pkg of packages) {
      const res = this.ingestMod(pkg);
      if (res.errors.length > 0) {
        allErrors.push(...res.errors);
      }
      if (res.success) {
        loadedMods.push(pkg.manifest.name || pkg.manifest.id);
      }
    }

    return { loadedMods, errors: allErrors };
  }
}
