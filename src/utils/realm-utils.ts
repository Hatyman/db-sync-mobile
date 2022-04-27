import { RealmService } from 'services/RealmService';
import { useEffect, useRef, useState } from 'react';
import Realm, { UpdateMode } from 'realm';
import { ChangeTypeNumber, TransactionScheme } from 'services/d';

let _realmService: RealmService;

export function setRealmService(realmService: RealmService) {
  _realmService = realmService;
}

export function getRealmService() {
  if (!_realmService) {
    _realmService = new RealmService();
  }
  return _realmService;
}

function isSimpleType(x: unknown): x is string | number | undefined | boolean | null {
  const xType = typeof x;
  return (
    x === null ||
    (xType !== 'object' && xType !== 'function' && xType !== 'bigint' && xType !== 'symbol')
  );
}

const detailsSelector = (results: any) => results;

type UseRealmDataProps<T> = {
  type: string;
  resultsSelector?: (objects: Realm.Results<T & Realm.Object>) => Realm.Results<T & Realm.Object>;
  isDataUpdateDisabled?: boolean;
};

export function useRealmData<T extends Record<string | number, any>>({
  type,
  resultsSelector = detailsSelector,
  isDataUpdateDisabled,
}: UseRealmDataProps<T>) {
  const [data, setData] = useState<(T & Realm.Object)[]>([]);
  const realmRef = useRef<Realm | null>(null);

  const realmSnapshotTempRef = useRef<Realm | null>(null);

  useEffect(() => {
    const service = getRealmService();
    service.open().then(({ realm, snapshotRealm }) => {
      realmRef.current = realm;
      realmSnapshotTempRef.current = snapshotRealm;
      const dataReference = realm.objects<T>(type);
      const dataResults = resultsSelector(dataReference);
      const snapshotReference = snapshotRealm.objects<T>(type);
      const objectSchema =
        dataReference[0]?.objectSchema() ?? realm.schema.find(x => x.name === type);
      const primaryKeyName = objectSchema?.primaryKey ?? objectSchema?.primaryKey ?? 'Id';

      if (!isDataUpdateDisabled) {
        // set state to the initial value of your realm objects
        setData([...dataResults]);
      }

      const isSyncEnabled = service.isTableSyncEnabled(type);
      try {
        dataReference.addListener((currentData, changes) => {
          const creationDate = new Date();

          if (!isDataUpdateDisabled) {
            // update state of data to the updated value
            setData([...dataResults]);
          }

          if (!isSyncEnabled) return;

          snapshotRealm.write(() => {
            service.safeWrite(() => {
              // Handle deleted Dog objects
              changes.deletions.forEach(index => {
                // You cannot directly access deleted objects,
                // but you can update a UI list, etc. based on the index.
                console.log('Deleted index', index);
                const snapshotDeletedItem = snapshotReference[index];
                console.log('Deleted  data', snapshotDeletedItem);
                try {
                  realm.create<TransactionScheme>(RealmService.TransactionsName, {
                    Id: RealmService.getNewId(),
                    ChangeType: ChangeTypeNumber.Delete,
                    isSynced: false,
                    InstanceId: snapshotDeletedItem[primaryKeyName],
                    CreationDate: creationDate,
                    TableName: type,
                  });
                } catch (e) {
                  console.error('Error on delete', e);
                } finally {
                  snapshotRealm.delete(snapshotDeletedItem);
                }
              });
              // Handle newly added Dog objects
              changes.insertions.forEach(index => {
                const insertedObject = currentData[index];
                console.log('Inserted', insertedObject);
                console.log('InstanceId', insertedObject[primaryKeyName]);

                const content = {} as Record<string, any>;

                for (const attribute of insertedObject.keys()) {
                  if (!service.isDbAttribute(type, attribute)) continue;

                  content[attribute] = insertedObject[attribute];
                }

                try {
                  realm.create<TransactionScheme>(RealmService.TransactionsName, {
                    Id: RealmService.getNewId(),
                    ChangeType: ChangeTypeNumber.Insert,
                    isSynced: false,
                    InstanceId: insertedObject[primaryKeyName],
                    CreationDate: creationDate,
                    Changes: content,
                    TableName: type,
                  });
                } catch (e) {
                  console.error('Error on creation', e);
                } finally {
                  snapshotRealm.create(type, insertedObject);
                }
              });
              // Handle Dog objects that were modified
              changes.oldModifications.forEach((index, i) => {
                const afterModifications = currentData[changes.newModifications[i]];
                const beforeModifications = snapshotReference[index];
                console.log('Modified from', beforeModifications);
                console.log('Modified   to', afterModifications);

                const changeSet: Record<string, string | number | boolean | null> = {};
                let attributes = afterModifications.keys();
                for (const attribute of attributes) {
                  const attributeSnapshot = beforeModifications[attribute];
                  const currentAttribute = afterModifications[attribute];
                  if (
                    attributeSnapshot !== currentAttribute &&
                    service.isDbAttribute(type, attribute) &&
                    service.isPropertySyncEnabled(type, attribute, isSyncEnabled)
                  ) {
                    changeSet[attribute] = currentAttribute ?? null;
                  }
                }

                try {
                  if (Object.values(changeSet).length) {
                    realm.create<TransactionScheme>(RealmService.TransactionsName, {
                      Id: RealmService.getNewId(),
                      ChangeType: ChangeTypeNumber.Update,
                      isSynced: false,
                      InstanceId: afterModifications[primaryKeyName],
                      CreationDate: creationDate,
                      TableName: type,
                      Changes: changeSet,
                    });
                  }
                } catch (e) {
                  console.log('Error on modifying', e);
                } finally {
                  snapshotRealm.create(type, afterModifications, UpdateMode.Modified);
                }
              });
            });
          });
          console.log(
            '-------------------------------------------------------------------------------------'
          );
        });
      } catch (error) {
        console.error(
          `Unable to update the tasks' state, an exception was thrown within the change listener: ${error}`
        );
      }

      return () => {
        dataReference.removeAllListeners();
        realmRef.current = null;
        realmSnapshotTempRef.current = null;
        realm.close();
      };
    });
  }, []);

  return { data, realm: realmRef.current, snapshotRealm: realmSnapshotTempRef.current };
}

export function useTransactions() {
  const [data, setData] = useState<(TransactionScheme & Realm.Object)[]>([]);
  useEffect(() => {
    const service = getRealmService();
    service.open().then(({ realm }) => {
      const transactions = realm.objects<TransactionScheme>(RealmService.TransactionsName);
      setData([...transactions]);
      try {
        transactions.addListener(() => {
          setData([...transactions]);
        });
      } catch (error) {
        console.error(
          `Unable to update the tasks' state, an exception was thrown within the change listener: ${error}`
        );
      }
      return () => {
        transactions.removeAllListeners();
        realm.close();
      };
    });
  }, []);

  return data;
}
