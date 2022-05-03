import Realm, { BSON, UpdateMode } from 'realm';
import {
  AttributeDto,
  ConnectionSchemeDto,
  DbSchemeDto,
  DbSchemeQuery,
  IDbSchemeDto,
  ITransactionDto,
  RealmDataType,
  TableSchemeDto,
  TransactionDto,
} from 'services/api/api-client';
import { getTextWithLowerFirstLetter } from 'utils/text-utils';
import {
  ChangeTypeNumber,
  ConnectionTypeEnum,
  DbSchemeConfig,
  ITransactionNumberDto,
  TransactionScheme,
} from 'services/d';
import { TransactionsReceivedCallback, TransportService } from 'services/TransportService';
import throttle from 'lodash.throttle';
import { DebouncedFunc } from 'lodash';

type AppliedChangeTypeTransactions = Map<string, ITransactionNumberDto[]>;
type AppliedTypeTransactions = Record<ChangeTypeNumber, AppliedChangeTypeTransactions | undefined>;
type AppliedTransactions = Record<string, AppliedTypeTransactions | undefined>;

export class RealmService {
  public readonly schemeConfig: DbSchemeConfig | undefined;
  public dbSchemeDto: DbSchemeDto | undefined;

  protected readonly registeredTypeListeners: Record<string, boolean> = {};
  public readonly appliedTransactions: AppliedTransactions = {};

  public transportService: TransportService;

  public static readonly TransactionsName = 'Transactions';

  private readonly loadingPromise: Promise<void>;

  private readonly throttledTransactionsSend: DebouncedFunc<
    (unSyncedTransactions: TransactionScheme[]) => Promise<void>
  >;

  private transactionsRealm: Realm | null = null;

  private _schemas: Realm.ObjectSchema[] = [];
  public get schemas() {
    return this._schemas;
  }

  constructor(schemeConfig?: DbSchemeConfig, syncPath?: string) {
    this.schemeConfig = schemeConfig;
    this.loadingPromise = this.loadSchemas();
    this.transportService = new TransportService({
      path: syncPath,
      onTransactionsReceived: this.onTransactionsReceived,
    });

    // Decide whether it needs to be cancelled or not.
    this.throttledTransactionsSend = throttle(this._sendTransactions, 300);

    this.initializeTransactionsSync().catch(e =>
      console.error('error on transactions sync initializing', e)
    );
  }

  public registerTypeListener = (type: string) => {
    this.registeredTypeListeners[type] = true;
  };

  public usRegisterTypeListener = (type: string) => {
    this.registeredTypeListeners[type] = false;
  };

  protected isTypeListenerRegistered = (type: string): boolean =>
    Boolean(this.registeredTypeListeners[type]);

  public safeWrite = (func: () => void, realm?: Realm) => {
    if (!this.transactionsRealm && realm) {
      this.transactionsRealm = realm;
    } else if (!this.transactionsRealm && !realm) {
      throw new Error('Realm is not opened');
    }

    const properRealm = realm ?? this.transactionsRealm;

    if (properRealm?.isInTransaction) {
      func();
    } else {
      properRealm?.write(func);
    }
  };

  public safeWriteForRealm = (realm: Realm, func: () => void) => {
    this.safeWrite(func, realm);
  };

  private _sendTransactions = async (unSyncedTransactions: TransactionScheme[]) => {
    const requestData: ITransactionDto[] = unSyncedTransactions
      .slice(0, 30)
      .map(this.convertTransactionSchemeToDto);
    const syncedTransactionsIds = await this.transportService.invokeTransactions(requestData);

    if (unSyncedTransactions.length > 30) {
      this.throttledTransactionsSend(unSyncedTransactions.slice(30));
    }

    if (!this.transactionsRealm) {
      const { realm } = await this.open();
      this.transactionsRealm = realm;
    }

    const syncDate = new Date();

    this.safeWrite(() => {
      for (const transactionId of syncedTransactionsIds) {
        const transaction = this.transactionsRealm?.objectForPrimaryKey<TransactionScheme>(
          RealmService.TransactionsName,
          transactionId
        );
        if (!transaction) {
          throw new Error('There is no such transaction!');
        }

        transaction.isSynced = true;
        transaction.SyncDate = syncDate;
      }
    });
    console.log('syncedTransactionsIds', syncedTransactionsIds);
  };

  protected loadSchemas = async () => {
    try {
      this.dbSchemeDto = await DbSchemeQuery.Client.getTableScheme();
      this._schemas = this.getDbScheme(this.dbSchemeDto);
      console.log('this._schemas', this._schemas);
    } catch (e) {
      console.error(JSON.stringify(e));
    }
  };

  private convertTransactionSchemeToDto = (transaction: TransactionScheme) => {
    const tableMataData = this.getTableMetaData(transaction.TableName);
    return {
      id: transaction.Id,
      entityFullName: tableMataData.entityFullName,
      assemblyName: tableMataData.assemblyName,
      changes: transaction.Changes,
      changeType: transaction.ChangeType as any,
      creationDate: transaction.CreationDate,
      instanceId: transaction.InstanceId,
      tableName: transaction.TableName,
      syncDate: transaction.SyncDate ?? null,
    };
  };

  public getTableMetaData = (
    tableName: string
  ): Pick<TransactionDto, 'entityFullName' | 'assemblyName'> => {
    const tableScheme = this.dbSchemeDto?.tables[tableName];
    if (!tableScheme) return {} as any;

    return {
      assemblyName: tableScheme.assemblyName,
      entityFullName: tableScheme.entityFullName,
    };
  };

  public open = async () => {
    await this.loadingPromise;
    const realm = await Realm.open({
      schema: this._schemas,
      path: 'realmDb',
      deleteRealmIfMigrationNeeded: true,
    });
    const snapshotRealm = await Realm.open({
      schema: this._schemas.filter(x => x.name !== RealmService.TransactionsName),
      path: 'realmDb.snapshot',
      deleteRealmIfMigrationNeeded: true,
    });
    return { realm, snapshotRealm };
  };

  private initializeTransactionsSync = async () => {
    const { realm } = await this.open();
    this.transactionsRealm = realm;
    const transactions = realm
      .objects<TransactionScheme>(RealmService.TransactionsName)
      .filtered('isSynced == false')
      .sorted('CreationDate');

    this.throttledTransactionsSend([...transactions]);

    transactions.addListener((_, changes) => {
      if (!changes.insertions.length) return;

      this.throttledTransactionsSend([...transactions]);
    });
  };

  private onTransactionsReceived: TransactionsReceivedCallback = transactions => {
    this.safeWrite(() => {
      const syncDate = new Date();
      for (const transaction of transactions) {
        console.log('received transaction', transaction);

        const realm = this.transactionsRealm!;

        switch (transaction.changeType) {
          case ChangeTypeNumber.Delete:
            const itemToBeDeleted = realm.objectForPrimaryKey(
              transaction.tableName,
              transaction.instanceId
            );
            realm.delete(itemToBeDeleted);
            break;

          case ChangeTypeNumber.Insert:
            realm.create(transaction.tableName, transaction.changes!);
            break;

          case ChangeTypeNumber.Update:
            const itemToBeModified = realm.objectForPrimaryKey<Record<string, any>>(
              transaction.tableName,
              transaction.instanceId
            );

            // todo: handle corner case error
            if (!itemToBeModified) break;

            Object.assign(itemToBeModified, transaction.changes);
            break;
        }
        realm.create<TransactionScheme>('Transactions', {
          Id: transaction.id,
          Changes: transaction.changes,
          ChangeType: transaction.changeType,
          CreationDate: transaction.creationDate,
          TableName: transaction.tableName,
          InstanceId: transaction.instanceId,
          SyncDate: syncDate,
          isSynced: true,
        });

        if (!this.isTypeListenerRegistered(transaction.tableName)) continue;

        let typeTransactions: AppliedTypeTransactions | undefined =
          this.appliedTransactions[transaction.tableName];
        if (!typeTransactions) {
          typeTransactions = {} as AppliedTypeTransactions;
          this.appliedTransactions[transaction.tableName] = typeTransactions;
        }

        let changeTypeTransactions: AppliedChangeTypeTransactions | undefined =
          typeTransactions[transaction.changeType];
        if (!changeTypeTransactions) {
          changeTypeTransactions = new Map<string, ITransactionNumberDto[]>();
          typeTransactions[transaction.changeType] = changeTypeTransactions;
        }

        const instanceTransactions = changeTypeTransactions.get(transaction.instanceId);
        if (!instanceTransactions) {
          changeTypeTransactions.set(transaction.instanceId, [transaction]);
        } else {
          instanceTransactions.push(transaction);
        }
      }
    });
  };

  private getDbScheme = (dbScheme: DbSchemeDto): Realm.ObjectSchema[] => {
    const tableSchemas: Realm.ObjectSchema[] = [];

    for (const tableName in dbScheme.tables) {
      if (this.schemeConfig && tableName !== RealmService.TransactionsName) {
        if (Array.isArray(this.schemeConfig) && !this.schemeConfig.includes(tableName)) {
          continue;
        } else if (!Array.isArray(this.schemeConfig) && !(tableName in this.schemeConfig)) {
          continue;
        } else {
          // do nothing
        }
      }
      const tableScheme = dbScheme.tables[tableName];
      const properties: Realm.PropertiesTypes = {};

      if (tableName === RealmService.TransactionsName) {
        Object.assign(properties, {
          isSynced: getTextWithLowerFirstLetter(RealmDataType.Bool),
        });
      }

      for (const attributeName in tableScheme.attributes) {
        const attribute = tableScheme.attributes[attributeName];
        properties[attributeName] = RealmService.getRealmType(attribute);
      }

      Object.assign(
        properties,
        RealmService.getRelationshipProperties(tableScheme, dbScheme.tables)
      );

      tableSchemas.push({
        name: tableScheme.name,
        primaryKey: tableScheme.primaryKeys[0],
        properties,
      });
    }

    return tableSchemas;
  };

  private static getRelationshipProperties = (
    tableScheme: TableSchemeDto,
    tables: IDbSchemeDto['tables']
  ): Realm.PropertiesTypes => {
    const relationshipProperties: Realm.PropertiesTypes = {};

    for (const connectedTableName in tableScheme.connections) {
      const connection = tableScheme.connections[connectedTableName];
      const connectionType = RealmService.getConnectionType(connection, tableScheme, tables);

      let attributeName =
        connectionType === ConnectionTypeEnum.OneToMany
          ? RealmService.getConnectionFieldListName(connection.tableName)
          : connection.tableName;

      relationshipProperties[attributeName] = RealmService.getConnectionAttributeType(
        connectionType,
        connection,
        tableScheme
      );
    }

    return relationshipProperties;
  };

  private static getConnectionAttributeType = (
    connectionType: ConnectionTypeEnum,
    connection: ConnectionSchemeDto,
    table: TableSchemeDto
  ): Realm.PropertyType | Realm.ObjectSchemaProperty => {
    switch (connectionType) {
      case ConnectionTypeEnum.OneToOne:
        if (connection.isIncomingReference) {
          return {
            type: 'linkingObjects',
            objectType: connection.tableName,
            property: table.name,
          };
        } else {
          let type = connection.tableName;
          if (
            connection.ownAttributeNames?.every(
              attributeName => table.attributes[attributeName].isNullable
            )
          ) {
            type += '?';
          }
          return type;
        }
      case ConnectionTypeEnum.ManyToOne:
        return {
          type: 'linkingObjects',
          objectType: connection.tableName,
          property: RealmService.getConnectionFieldListName(table.name),
        };
      case ConnectionTypeEnum.OneToMany:
        return `${connection.tableName}[]`;
    }
  };

  private static getConnectionFieldListName = (tableName: string): string => {
    return tableName + 'List';
  };

  private static getConnectionType = (
    connection: ConnectionSchemeDto,
    ownTable: TableSchemeDto,
    tables: IDbSchemeDto['tables']
  ): ConnectionTypeEnum => {
    if (connection.isIncomingReference) {
      const connectedTableAttributes = tables[connection.tableName].attributes;
      if (
        connection.externalAttributeNames?.some(
          attributeName => connectedTableAttributes[attributeName].isUnique
        )
      ) {
        return ConnectionTypeEnum.OneToOne;
      } else {
        return ConnectionTypeEnum.OneToMany;
      }
    } else if (
      connection.ownAttributeNames?.some(
        attributeName => ownTable.attributes[attributeName].isUnique
      )
    ) {
      return ConnectionTypeEnum.OneToOne;
    } else {
      return ConnectionTypeEnum.ManyToOne;
    }
  };

  private static getRealmType = (attribute: AttributeDto): string | Realm.ObjectSchemaProperty => {
    let type: string | Realm.ObjectSchemaProperty = '';
    if (attribute.scheme.type) {
      type = getTextWithLowerFirstLetter(attribute.scheme.type);
      if (type === 'dictionary') {
        type = {
          type,
          objectType: 'mixed',
          optional: attribute.isNullable,
        };
      }
    } else if (attribute.scheme.ref) {
      type = 'int';
    }
    if (typeof type === 'string' && attribute.isNullable) {
      type += '?';
    }

    return type;
  };

  public static getNewId(): string {
    return new BSON.UUID().toHexString();
  }

  public isTableSyncEnabled = (tableName: string): boolean => {
    if (this.schemeConfig instanceof Array) {
      return this.schemeConfig.includes(tableName);
    } else if (this.schemeConfig) {
      return tableName in this.schemeConfig;
    } else {
      return false;
    }
  };

  public isPropertySyncEnabled = (
    tableName: string,
    propertyName: string,
    isTableSyncEnabled?: boolean
  ): boolean => {
    if (this.schemeConfig instanceof Array) {
      // We return true because it must be already checked by isTableSyncEnabled
      return isTableSyncEnabled ?? this.isTableSyncEnabled(tableName);
    } else if (this.schemeConfig) {
      return Boolean(this.schemeConfig[tableName]?.properties[propertyName]);
    } else {
      return false;
    }
  };

  public isDbAttribute = (tableName: string, attributeName: string): boolean => {
    return Boolean(
      this.dbSchemeDto &&
        tableName in this.dbSchemeDto.tables &&
        attributeName in this.dbSchemeDto.tables[tableName].attributes
    );
  };
}
