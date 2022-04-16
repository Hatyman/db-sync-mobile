import Realm, { BSON } from 'realm';
import {
  AttributeDto,
  ConnectionSchemeDto,
  DbSchemeDto,
  DbSchemeQuery,
  IDbSchemeDto,
  RealmDataType,
  TableSchemeDto,
} from 'services/api/api-client';
import { getTextWithLowerFirstLetter } from 'utils/text-utils';
import { ConnectionTypeEnum, DbSchemeConfig } from 'services/d';

export class RealmService {
  public readonly schemeConfig: DbSchemeConfig | undefined;
  public dbSchemeDto: DbSchemeDto | undefined;

  public static readonly TransactionsName = 'Transactions';

  private readonly loadingPromise: Promise<void>;

  private _schemas: Realm.ObjectSchema[] = [];
  public get schemas() {
    return this._schemas;
  }

  constructor(schemeConfig?: DbSchemeConfig) {
    this.schemeConfig = schemeConfig;
    this.loadingPromise = this.loadSchemas();
  }

  protected async loadSchemas() {
    try {
      this.dbSchemeDto = await DbSchemeQuery.Client.getTableScheme();
      this._schemas = this.getDbScheme(this.dbSchemeDto);
    } catch (e) {
      console.error(JSON.stringify(e));
    }
  }

  public open = async () => {
    await this.loadingPromise;
    console.log('this._schemas', this._schemas);
    const realm = await Realm.open({
      schema: this._schemas,
      path: 'realmDb',
      deleteRealmIfMigrationNeeded: true,
    });
    const snapshotRealm = await Realm.open({
      schema: this._schemas.filter(x => x.name !== RealmService.TransactionsName),
      path: 'realmDb.snapshot',
    });
    return { realm, snapshotRealm };
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
