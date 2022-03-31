import Realm, { ObjectSchema, ObjectSchemaProperty, PropertiesTypes, PropertyType } from 'realm';
import {
  AttributeDto,
  ConnectionSchemeDto,
  DbSchemeDto,
  IDbSchemeDto,
  TableSchemeDto,
} from 'services/api/api-client';
import { getTextWithLowerFirstLetter } from 'utils/text-utils';

enum ConnectionTypeEnum {
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

/**
 * const path = attribute.scheme.ref.split('/')
 * const typeName = path[path.length - 1];
 * const scheme = schemas[typeName]?.enum
 */

function getRealmType(attribute: AttributeDto): string {
  let type: string = '';
  if (attribute.scheme.type) {
    type = getTextWithLowerFirstLetter(attribute.scheme.type);
  } else if (attribute.scheme.ref) {
    type = 'int';
  }
  if (attribute.isNullable) {
    type += '?';
  }

  return type;
}

function getConnectionType(
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
    connection.ownAttributeNames?.some(attributeName => ownTable.attributes[attributeName].isUnique)
  ) {
    return ConnectionTypeEnum.OneToOne;
  } else {
    return ConnectionTypeEnum.ManyToOne;
  }
}

function getConnectionFieldListName(connection: ConnectionSchemeDto): string {
  return connection.tableName + 'List';
}

function getConnectionAttributeType(
  connectionType: ConnectionTypeEnum,
  connection: ConnectionSchemeDto,
  table: TableSchemeDto
): PropertyType | ObjectSchemaProperty {
  switch (connectionType) {
    case ConnectionTypeEnum.OneToOne:
      if (connection.isIncomingReference) {
        return {
          type: 'linkingObjects',
          objectType: connection.tableName,
          property: connection.tableName,
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
        property: getConnectionFieldListName(connection),
      };
    case ConnectionTypeEnum.OneToMany:
      return `${connection.tableName}[]`;
  }
}

function getRelationshipProperties(
  tableScheme: TableSchemeDto,
  tables: IDbSchemeDto['tables']
): PropertiesTypes {
  const relationshipProperties: PropertiesTypes = {};

  for (const connectedTableName in tableScheme.connections) {
    const connection = tableScheme.connections[connectedTableName];
    const connectionType = getConnectionType(connection, tableScheme, tables);
    switch (connectionType) {
      case ConnectionTypeEnum.OneToOne:
        relationshipProperties[connection.tableName] = getConnectionAttributeType(
          ConnectionTypeEnum.OneToOne,
          connection,
          tableScheme
        );
        break;
      case ConnectionTypeEnum.ManyToOne:
        relationshipProperties[connection.tableName] = getConnectionAttributeType(
          ConnectionTypeEnum.ManyToOne,
          connection,
          tableScheme
        );
        break;
      case ConnectionTypeEnum.OneToMany:
        relationshipProperties[getConnectionFieldListName(connection)] = getConnectionAttributeType(
          ConnectionTypeEnum.OneToMany,
          connection,
          tableScheme
        );
        break;
    }
  }

  return relationshipProperties;
}

function getDbScheme(dbScheme: DbSchemeDto): ObjectSchema[] {
  const tableSchemas: ObjectSchema[] = [];

  for (const tableName in dbScheme.tables) {
    const tableScheme = dbScheme.tables[tableName];
    const properties: PropertiesTypes = {};

    for (const attributeName in tableScheme.attributes) {
      const attribute = tableScheme.attributes[attributeName];
      properties[attributeName] = getRealmType(attribute);
    }

    Object.assign(properties, getRelationshipProperties(tableScheme, dbScheme.tables));

    tableSchemas.push({
      name: tableScheme.name,
      primaryKey: tableScheme.primaryKeys[0],
      properties,
    });
  }

  return tableSchemas;
}

export async function openDbConnection(dbScheme: DbSchemeDto): Promise<Realm> {
  const tableSchemas: ObjectSchema[] = getDbScheme(dbScheme);

  const realm = await Realm.open({
    path: 'myrealm',
    schema: tableSchemas,
  });
  return realm;
}
