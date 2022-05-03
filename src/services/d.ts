// There could be defined only needed attributes
import { ITransactionDto } from 'services/api/api-client';

export type TableSchemeConfig = {
  properties: Record<string, boolean>;
  // todo: make it sense (extract get table scheme, get all connected tables, check whether this table is schemed and add its scheme)
  isConnectionsIncluded?: boolean;
};
export type DbSchemeConfig = string[] | Record<string, TableSchemeConfig>;

export enum ConnectionTypeEnum {
  OneToOne,
  /**
   * Many own records connected with one external record
   */
  ManyToOne,
  /**
   * Own record has many connected external records
   */
  OneToMany,
}

export enum ChangeTypeNumber {
  Insert,
  Update,
  Delete,
}

export type TransactionScheme = {
  isSynced: boolean;
  Id: string;
  ChangeType: ChangeTypeNumber;
  Changes?: Record<string, string | number | boolean | null>;
  CreationDate: Date;
  InstanceId: string;
  SyncDate?: Date;
  TableName: string;
};
export type ITransactionNumberDto = Omit<ITransactionDto, 'changeType'> & {
  changeType: ChangeTypeNumber;
};
