import Realm from 'realm';
import {
  AttributeDto,
  ConnectionSchemeDto,
  DbSchemeDto,
  DbSchemeQuery,
  IDbSchemeDto,
  ITransactionDto,
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

type LastSyncTransactionScheme = {
  Id: number;
  TransactionId: string;
};

export class RealmService {
  public readonly schemeConfig: DbSchemeConfig | undefined;
  public dbSchemeDto: DbSchemeDto | undefined;

  protected readonly registeredTypeListeners: Record<string, boolean> = {};
  public readonly appliedTransactions: AppliedTransactions = {};

  public transportService: TransportService | null = null;

  public static readonly transactionsName = 'Transactions';

  private readonly loadingPromise: Promise<void>;

  private readonly throttledTransactionsSend: DebouncedFunc<
    (unSyncedTransactions: TransactionScheme[]) => Promise<void>
  >;

  private realm: Realm | null = null;
  private snapshotRealm: Realm | null = null;

  public isReadyToSendTransactions: boolean = false;

  private static readonly lastSyncTransactionKey = 0;
  private static readonly lastSyncTransactionScheme: Realm.ObjectSchema = {
    name: 'lastSyncTransaction',
    primaryKey: 'Id',
    properties: {
      Id: 'int',
      TransactionId: 'string',
    },
  };

  private _schemas: Realm.ObjectSchema[] = [RealmService.lastSyncTransactionScheme];

  public get schemas() {
    return this._schemas;
  }

  constructor(schemeConfig?: DbSchemeConfig, syncPath?: string) {
    this.schemeConfig = schemeConfig;
    this.loadingPromise = (async () => {
      const { realm } = await this.openIfNeeded();
      const lastSyncTransaction = realm.objectForPrimaryKey<LastSyncTransactionScheme>(
        RealmService.lastSyncTransactionScheme.name,
        RealmService.lastSyncTransactionKey
      );
      const lastSyncTransactionId = lastSyncTransaction?.TransactionId;
      this.close();
      this.transportService = new TransportService({
        path: syncPath,
        onTransactionsReceived: this.onTransactionsReceived,
        lastSyncTransactionId,
        onDisconnect: () => {
          this.isReadyToSendTransactions = false;
        },
      });
      await this.loadSchemas();
    })();

    // Decide whether it needs to be cancelled or not.
    this.throttledTransactionsSend = throttle(this._sendTransactions, 300);

    this.initializeTransactionsSync().catch(e =>
      console.error('error on transactions sync initializing', e)
    );
  }

  public registerTypeListener = (type: string) => {
    this.registeredTypeListeners[type] = true;
  };

  public unRegisterTypeListener = (type: string) => {
    this.registeredTypeListeners[type] = false;
  };

  protected isTypeListenerRegistered = (type: string): boolean =>
    Boolean(this.registeredTypeListeners[type]);

  public safeWrite = (func: () => void, realm?: Realm) => {
    if (!this.realm && !realm) {
      throw new Error('Realm is not opened');
    }

    const properRealm = realm ?? this.realm;

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
    if (!this.transportService || !this.isReadyToSendTransactions) {
      return this.throttledTransactionsSend(unSyncedTransactions);
    }

    const requestData: ITransactionDto[] = unSyncedTransactions
      .slice(0, 30)
      .map(this.convertTransactionSchemeToDto);
    const syncedTransactionsIds = await this.transportService.invokeTransactions(requestData);

    if (unSyncedTransactions.length > 30) {
      this.throttledTransactionsSend(unSyncedTransactions.slice(30));
    }

    if (!syncedTransactionsIds.length) return;

    await this.openIfNeeded();

    this.safeWrite(() => {
      const transactionsToBeDeleted = this.realm
        ?.objects(RealmService.transactionsName)
        .filtered(RealmService.convertArrayToFilterCondition('Id', syncedTransactionsIds));

      if (transactionsToBeDeleted?.length) {
        this.realm?.delete(transactionsToBeDeleted);
      }

      if (!syncedTransactionsIds.length) return;

      this.realm?.create<LastSyncTransactionScheme>(
        RealmService.lastSyncTransactionScheme.name,
        {
          Id: RealmService.lastSyncTransactionKey,
          TransactionId: syncedTransactionsIds[syncedTransactionsIds.length - 1],
        },
        Realm.UpdateMode.Modified
      );
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

  /**
   * Assigns realm and snapshotRealm properties for service and returns them
   */
  public openIfNeeded = async () => {
    await this.loadingPromise;

    if (!this.realm || this.realm.isClosed) {
      this.realm = await Realm.open({
        schema: this._schemas,
        path: 'realmDb',
        deleteRealmIfMigrationNeeded: true,
      });
    }

    if (!this.snapshotRealm || this.snapshotRealm.isClosed) {
      this.snapshotRealm = await Realm.open({
        schema: this._schemas.filter(
          x =>
            x.name !== RealmService.transactionsName &&
            x.name !== RealmService.lastSyncTransactionScheme.name
        ),
        path: 'realmDb.snapshot',
        deleteRealmIfMigrationNeeded: true,
      });
    }

    return {
      realm: this.realm,
      snapshotRealm: this.snapshotRealm,
    };
  };

  public close = () => {
    if (this.realm) {
      this.realm.close();
    }

    if (this.snapshotRealm) {
      this.snapshotRealm.close();
    }
  };

  private initializeTransactionsSync = async () => {
    await this.openIfNeeded();
    const transactions = this.realm!.objects<TransactionScheme>(
      RealmService.transactionsName
    ).sorted('CreationDate');

    this.throttledTransactionsSend([...transactions]);

    transactions.addListener((_, changes) => {
      if (!changes.insertions.length && !changes.newModifications.length) return;

      this.throttledTransactionsSend([...transactions]);
    });
  };

  private onTransactionsReceived: TransactionsReceivedCallback = async transactions => {
    console.log('received from hub', transactions);

    await this.openIfNeeded();

    const realm = this.realm!;
    const snapshotRealm = this.snapshotRealm!;

    this.safeWriteForRealm(snapshotRealm, () =>
      this.safeWrite(() => {
        let lastSyncTransactionId: string | null = null;

        const nowDate = new Date();
        const deletedIds: string[] = [];
        const insertedIds: Set<string> = new Set();
        const modifiedPropertiesMap = new Map<string, Record<string, any>>();

        for (const transaction of transactions) {
          console.log('received transaction', transaction);

          switch (transaction.changeType) {
            case ChangeTypeNumber.Delete:
              const itemToBeDeleted = realm.objectForPrimaryKey(
                transaction.tableName,
                transaction.instanceId
              );

              if (itemToBeDeleted) {
                console.log('Deletion from hub:', itemToBeDeleted);

                realm.delete(itemToBeDeleted);
              }

              /**
               * We avoid applying transactions for snapshot data in cases:
               * 1 when this table is being listened in hook and allow to apply this transaction
               * for snapshot data in this listener.
               * Because we want to get deleted instance id to check it in applied from hub
               * transactions map and avoid creation wrong transactions.
               *
               * 2 We have inserted this instance just now from hub. After this write realm transaction
               * is finished, listener will be only triggered with only inserted notifications
               * (and modified if instance already exists in realm DB), so inserted and then deleted
               * at the same time won't be recorded to changes for listener, but we are already have
               * changed snapshot, due to it, we have to keep it the same as data "for show" and
               * apply this transaction for snapshot also even there is type listener registered.
               *
               * Other applyings for snapshot data are done in this function and avoided in hook.
               */
              if (
                !this.isTypeListenerRegistered(transaction.tableName) ||
                insertedIds.has(transaction.instanceId)
              ) {
                const snapshotToBeDeleted = snapshotRealm.objectForPrimaryKey(
                  transaction.tableName,
                  transaction.instanceId
                );

                if (snapshotToBeDeleted) {
                  console.log('Deletion snapshot from hub:', snapshotToBeDeleted);
                  snapshotRealm.delete(snapshotToBeDeleted);
                }
              }

              deletedIds.push(transaction.instanceId);
              break;

            case ChangeTypeNumber.Insert:
              realm.create(transaction.tableName, transaction.changes!);
              snapshotRealm.create(transaction.tableName, transaction.changes!);
              insertedIds.add(transaction.instanceId);
              break;

            case ChangeTypeNumber.Update:
              const itemToBeModified = realm.objectForPrimaryKey<Record<string, any>>(
                transaction.tableName,
                transaction.instanceId
              );
              const snapshotToBeModified = snapshotRealm.objectForPrimaryKey<Record<string, any>>(
                transaction.tableName,
                transaction.instanceId
              );

              // todo: handle corner case error when there is no item
              if (itemToBeModified) {
                let instanceChanges = modifiedPropertiesMap.get(transaction.instanceId);
                if (!instanceChanges) {
                  instanceChanges = {};
                  modifiedPropertiesMap.set(transaction.instanceId, instanceChanges);
                }
                Object.assign(instanceChanges, transaction.changes);

                console.log('Before modification from hub', itemToBeModified);
                Object.assign(itemToBeModified, transaction.changes);
                console.log('After modification from hub', itemToBeModified);
              } else {
                console.warn(
                  `Received transaction for ${transaction.tableName} instance id: ${transaction.instanceId}, but it was not found in realm DB`
                );
              }

              if (snapshotToBeModified) {
                Object.assign(snapshotToBeModified, transaction.changes);
              }

              break;
          }

          lastSyncTransactionId = transaction.id;

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

        console.log('delete transactions for instance ids:', deletedIds);
        if (deletedIds.length) {
          /**
           * We want to delete all local transactions for already deleted instance.
           * There are only modify and delete transactions could be.
           */
          realm.delete(
            realm
              .objects<TransactionScheme>(RealmService.transactionsName)
              .filtered(RealmService.convertArrayToFilterCondition('InstanceId', deletedIds))
          );
        }

        console.log('modifiedPropertiesMap', modifiedPropertiesMap);
        if (modifiedPropertiesMap.size) {
          const modifyTransactions = realm
            .objects<TransactionScheme>(RealmService.transactionsName)
            .filtered(
              `ChangeType == $0 && (${RealmService.convertArrayToFilterCondition('InstanceId', [
                ...modifiedPropertiesMap.keys(),
              ])})`,
              ChangeTypeNumber.Update
            )
            .sorted('CreationDate');

          const changesMap = new Map<string, TransactionScheme>();

          for (const modifyTransaction of modifyTransactions) {
            let instanceSummaryTransaction = changesMap.get(modifyTransaction.InstanceId);

            if (!instanceSummaryTransaction) {
              changesMap.set(modifyTransaction.InstanceId, {
                Id: RealmService.getNewId(),
                ChangeType: modifyTransaction.ChangeType,
                TableName: modifyTransaction.TableName,
                InstanceId: modifyTransaction.InstanceId,
                Changes: {
                  ...modifyTransaction.Changes,
                },
                CreationDate: nowDate,
              });
            } else {
              Object.assign(instanceSummaryTransaction.Changes, modifyTransaction.Changes);
            }
          }
          console.log('delete modifyTransactions', modifyTransactions);
          realm.delete(modifyTransactions);
          console.log('changesMap', changesMap);
          for (const accumulatedTransaction of changesMap.values()) {
            const affectedProperties = modifiedPropertiesMap.get(
              accumulatedTransaction.InstanceId
            )!;

            for (const property in accumulatedTransaction.Changes) {
              if (!(property in affectedProperties)) continue;

              delete accumulatedTransaction.Changes[property];
            }

            if (
              !accumulatedTransaction.Changes ||
              !Object.values(accumulatedTransaction.Changes).length
            ) {
              continue;
            }

            realm.create<TransactionScheme>(RealmService.transactionsName, accumulatedTransaction);
            console.log('Added accumulated transaction', accumulatedTransaction);
          }
        }

        if (!this.isReadyToSendTransactions) {
          this.isReadyToSendTransactions = true;
        }

        if (!lastSyncTransactionId) return;

        this.realm?.create<LastSyncTransactionScheme>(
          RealmService.lastSyncTransactionScheme.name,
          {
            Id: RealmService.lastSyncTransactionKey,
            TransactionId: lastSyncTransactionId,
          },
          Realm.UpdateMode.Modified
        );
      })
    );
  };

  private getDbScheme = (dbScheme: DbSchemeDto): Realm.ObjectSchema[] => {
    const tableSchemas: Realm.ObjectSchema[] = [RealmService.lastSyncTransactionScheme];

    for (const tableName in dbScheme.tables) {
      if (this.schemeConfig && tableName !== RealmService.transactionsName) {
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

  private static getRelationshipProperties(
    tableScheme: TableSchemeDto,
    tables: IDbSchemeDto['tables']
  ): Realm.PropertiesTypes {
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
  }

  private static getConnectionAttributeType(
    connectionType: ConnectionTypeEnum,
    connection: ConnectionSchemeDto,
    table: TableSchemeDto
  ): Realm.PropertyType | Realm.ObjectSchemaProperty {
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
  }

  private static getConnectionFieldListName(tableName: string): string {
    return tableName + 'List';
  }

  private static getConnectionType(
    connection: ConnectionSchemeDto,
    ownTable: TableSchemeDto,
    tables: IDbSchemeDto['tables']
  ): ConnectionTypeEnum {
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
  }

  private static getRealmType(attribute: AttributeDto): string | Realm.ObjectSchemaProperty {
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
  }

  public static getNewId(): string {
    return new Realm.BSON.UUID().toHexString();
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

  private static convertArrayToFilterCondition(propertyName: string, array: (string | number)[]) {
    return array
      .reduce((accumulator: string, item) => `${accumulator} || ${propertyName} == '${item}'`, '')
      .substring(4);
  }
}
