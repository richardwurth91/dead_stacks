import Ajv, { ValidateFunction } from 'ajv';
import cardSchema from '../../schemas/card.schema.json';
import blueprintSchema from '../../schemas/blueprint.schema.json';
import packSchema from '../../schemas/pack.schema.json';
import manifestSchema from '../../schemas/manifest.schema.json';
import { CardDefinition, BlueprintDefinition, PackDefinition, ModManifest } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export class SchemaValidator {
  private ajv: Ajv;
  private validateCard: ValidateFunction;
  private validateBlueprint: ValidateFunction;
  private validatePack: ValidateFunction;
  private validateManifest: ValidateFunction;

  constructor() {
    this.ajv = new Ajv({ allErrors: true });
    this.validateCard = this.ajv.compile(cardSchema);
    this.validateBlueprint = this.ajv.compile(blueprintSchema);
    this.validatePack = this.ajv.compile(packSchema);
    this.validateManifest = this.ajv.compile(manifestSchema);
  }

  private formatErrors(validateFn: ValidateFunction): string[] {
    if (!validateFn.errors) return [];
    return validateFn.errors.map((err) => `${err.instancePath || '/'} ${err.message}`);
  }

  validateCardDefinition(data: unknown): { valid: boolean; data?: CardDefinition; errors?: string[] } {
    const valid = this.validateCard(data);
    if (!valid) {
      return { valid: false, errors: this.formatErrors(this.validateCard) };
    }
    return { valid: true, data: data as CardDefinition };
  }

  validateBlueprintDefinition(data: unknown): { valid: boolean; data?: BlueprintDefinition; errors?: string[] } {
    const valid = this.validateBlueprint(data);
    if (!valid) {
      return { valid: false, errors: this.formatErrors(this.validateBlueprint) };
    }
    return { valid: true, data: data as BlueprintDefinition };
  }

  validatePackDefinition(data: unknown): { valid: boolean; data?: PackDefinition; errors?: string[] } {
    const valid = this.validatePack(data);
    if (!valid) {
      return { valid: false, errors: this.formatErrors(this.validatePack) };
    }
    return { valid: true, data: data as PackDefinition };
  }

  validateManifestDefinition(data: unknown): { valid: boolean; data?: ModManifest; errors?: string[] } {
    const valid = this.validateManifest(data);
    if (!valid) {
      return { valid: false, errors: this.formatErrors(this.validateManifest) };
    }
    return { valid: true, data: data as ModManifest };
  }
}

export const globalSchemaValidator = new SchemaValidator();
