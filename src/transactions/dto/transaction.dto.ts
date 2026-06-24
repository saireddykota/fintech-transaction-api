import {
  IsEnum, IsNotEmpty, IsNumber, IsString, IsDate,
  IsOptional, IsObject, Min, ValidateNested, IsISO8601
} from 'class-validator';
import { Type } from 'class-transformer';
import { TransactionType, AssetClass } from '../entities/transaction.entity';

export class FxDetailsDto {
  @IsString() @IsNotEmpty()
  baseCurrency: string;

  @IsString() @IsNotEmpty()
  quoteCurrency: string;

  @IsNumber() @Min(0)
  exchangeRate: number;

  @IsOptional() @IsNumber()
  forwardRate?: number;

  @IsOptional() @IsISO8601()
  maturityDate?: string;
}

export class OptionDetailsDto {
  @IsEnum(['CALL', 'PUT'])
  optionType: 'CALL' | 'PUT';

  @IsNumber() @Min(0)
  strikePrice: number;

  @IsISO8601()
  expirationDate: string;

  @IsString() @IsNotEmpty()
  underlyingInstrumentId: string;
}

export class CreateTransactionDto {
  @IsString() @IsNotEmpty()
  portfolioId: string;

  @IsString() @IsNotEmpty()
  accountId: string;

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsEnum(AssetClass)
  assetClass: AssetClass;

  @IsString() @IsNotEmpty()
  instrumentId: string;

  @IsString() @IsNotEmpty()
  instrumentName: string;

  @IsNumber() @Min(0)
  quantity: number;

  @IsNumber() @Min(0)
  price: number;

  @IsString() @IsNotEmpty()
  currency: string;

  @IsISO8601()
  settlementDate: string;

  @IsISO8601()
  tradeDate: string;

  @IsOptional() @IsString()
  brokerCode?: string;

  @IsOptional() @IsString()
  counterpartyId?: string;

  @IsOptional() @ValidateNested() @Type(() => FxDetailsDto)
  fxDetails?: FxDetailsDto;

  @IsOptional() @ValidateNested() @Type(() => OptionDetailsDto)
  optionDetails?: OptionDetailsDto;

  @IsOptional() @IsObject()
  metadata?: Record<string, any>;
}

export class TransactionQueryDto {
  @IsOptional() @IsString()
  portfolioId?: string;

  @IsOptional() @IsString()
  accountId?: string;

  @IsOptional() @IsEnum(TransactionType)
  type?: TransactionType;

  @IsOptional() @IsEnum(AssetClass)
  assetClass?: AssetClass;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsISO8601()
  fromDate?: string;

  @IsOptional() @IsISO8601()
  toDate?: string;

  @IsOptional() @IsNumber() @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional() @IsNumber() @Min(1)
  @Type(() => Number)
  limit?: number = 50;
}
