import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PortfolioDocument = Portfolio & Document;

export enum PortfolioStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CLOSED = 'CLOSED',
}

export enum PortfolioType {
  HEDGE_FUND = 'HEDGE_FUND',
  MUTUAL_FUND = 'MUTUAL_FUND',
  PENSION = 'PENSION',
  ENDOWMENT = 'ENDOWMENT',
  SEPARATELY_MANAGED = 'SEPARATELY_MANAGED',
}

@Schema({ timestamps: true, collection: 'portfolios' })
export class Portfolio {
  @Prop({ required: true, unique: true, index: true })
  portfolioId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, enum: PortfolioType, index: true })
  type: PortfolioType;

  @Prop({ required: true, enum: PortfolioStatus, default: PortfolioStatus.ACTIVE, index: true })
  status: PortfolioStatus;

  @Prop({ required: true, index: true })
  managerId: string;

  @Prop({ required: true })
  baseCurrency: string;

  @Prop({ required: true })
  inceptionDate: Date;

  @Prop({ default: 0 })
  totalNav: number;

  @Prop({ type: [String], default: [] })
  authorizedUsers: string[];

  @Prop({ type: Object })
  riskParameters?: {
    maxDrawdown: number;
    maxConcentration: number;
    varLimit: number;
  };

  @Prop({ type: Object })
  complianceMetadata?: {
    regulatoryJurisdiction: string;
    reportingFrequency: string;
    auditSchedule: string;
  };
}

export const PortfolioSchema = SchemaFactory.createForClass(Portfolio);

// Indexes for common query patterns
PortfolioSchema.index({ managerId: 1, status: 1 });
PortfolioSchema.index({ type: 1, status: 1 });
