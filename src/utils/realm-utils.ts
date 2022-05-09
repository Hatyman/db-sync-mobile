import { RealmService } from 'services/RealmService';
import { useEffect, useRef, useState } from 'react';
import Realm from 'realm';
import { ChangeTypeNumber, TransactionScheme } from 'services/d';
import equal from 'fast-deep-equal';

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
    service.openIfNeeded().then(({ realm, snapshotRealm }) => {
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
          if (
            !changes.insertions.length &&
            !changes.deletions.length &&
            !changes.newModifications.length
          ) {
            return;
          }

          const creationDate = new Date();

          if (!isDataUpdateDisabled) {
            // update state of data to the updated value
            setData([...dataResults]);
          }

          if (!isSyncEnabled) return;

          service.safeWriteForRealm(snapshotRealm, () => {
            service.safeWrite(() => {
              const typeTransactions = service.appliedTransactions[type];

              // Handle deleted objects
              for (const indexIsBeingDeleted of changes.deletions) {
                // You cannot directly access deleted objects,
                // but you can update a UI list, etc. based on the indexToBeDeleted.
                console.log('Deleted index', indexIsBeingDeleted);
                const snapshotDeletedItem = snapshotReference[indexIsBeingDeleted];
                console.log('Deleted snapshot data', snapshotDeletedItem);

                const deletedItemId = snapshotDeletedItem[primaryKeyName];
                const instanceTransactions =
                  typeTransactions?.[ChangeTypeNumber.Delete]?.get(deletedItemId);

                /**
                 * We delete item there to keep equal with "showed" data.
                 * We apply this change to snapshot data in any case because this applying was missed in hub-received
                 * callback to keep deleted data and check there its transactions (below) and avoid wrong transactions.
                 *
                 * Other changes (insert, modify) are applied to snapshot only if there is no
                 * transaction registered from hub, because it was already applied there.
                 */
                snapshotRealm.delete(snapshotDeletedItem);

                if (instanceTransactions?.length) {
                  if (instanceTransactions.length === 1) {
                    typeTransactions![ChangeTypeNumber.Delete]!.delete(deletedItemId);
                  } else {
                    instanceTransactions.shift();
                  }
                  continue;
                }

                try {
                  realm.create<TransactionScheme>(RealmService.transactionsName, {
                    Id: RealmService.getNewId(),
                    ChangeType: ChangeTypeNumber.Delete,
                    InstanceId: deletedItemId,
                    CreationDate: creationDate,
                    TableName: type,
                  });
                } catch (e) {
                  console.error('Error on delete transaction creation', e);
                }
              }

              // Handle newly added Dog objects
              for (const indexIsBeingInserted of changes.insertions) {
                const insertedObject = currentData[indexIsBeingInserted];
                console.log('Inserted', insertedObject);
                const insertedItemId = insertedObject[primaryKeyName];
                console.log('InstanceId', insertedItemId);

                const instanceTransactions =
                  typeTransactions?.[ChangeTypeNumber.Insert]?.get(insertedItemId);
                if (instanceTransactions?.length) {
                  if (instanceTransactions.length === 1) {
                    typeTransactions![ChangeTypeNumber.Insert]!.delete(insertedItemId);
                  } else {
                    instanceTransactions.shift();
                  }
                  continue;
                }

                snapshotRealm.create(type, insertedObject);

                const content = {} as Record<string, any>;

                for (const attribute of insertedObject.keys()) {
                  if (!service.isDbAttribute(type, attribute)) continue;

                  content[attribute] = insertedObject[attribute];
                }

                try {
                  realm.create<TransactionScheme>(RealmService.transactionsName, {
                    Id: RealmService.getNewId(),
                    ChangeType: ChangeTypeNumber.Insert,
                    InstanceId: insertedItemId,
                    CreationDate: creationDate,
                    Changes: content,
                    TableName: type,
                  });
                } catch (e) {
                  console.error('Error on insert transaction creation', e);
                }
              }

              // Handle Dog objects that were modified
              for (let i = 0; i < changes.oldModifications.length; i++) {
                const oldIndexIsBeingModified = changes.oldModifications[i];
                const newIndexIsBeingModified = changes.newModifications[i];

                let beforeModifications: (T & Object) | undefined =
                  snapshotReference[oldIndexIsBeingModified];
                const afterModifications = currentData[newIndexIsBeingModified];

                const modifiedItemId = afterModifications[primaryKeyName];

                if (beforeModifications?.[primaryKeyName] !== modifiedItemId) {
                  beforeModifications = snapshotReference[newIndexIsBeingModified];

                  if (beforeModifications?.[primaryKeyName] !== modifiedItemId) {
                    beforeModifications = snapshotRealm.objectForPrimaryKey(type, modifiedItemId);
                  }

                  if (beforeModifications?.[primaryKeyName] !== modifiedItemId) {
                    console.warn(
                      `Couldn't find ${type} snapshot for instance id: ${modifiedItemId}. It will be inserted to snapshot realm`
                    );
                    snapshotRealm.create(type, afterModifications, Realm.UpdateMode.Modified);
                    continue;
                  }
                }

                const changeSet: Record<string, string | number | boolean | null> = {};
                let attributes = afterModifications.keys();
                for (const attribute of attributes) {
                  const attributeSnapshot = beforeModifications?.[attribute];
                  const currentAttribute = afterModifications[attribute];

                  if (
                    !equal(attributeSnapshot, currentAttribute) &&
                    service.isDbAttribute(type, attribute) &&
                    service.isPropertySyncEnabled(type, attribute, isSyncEnabled)
                  ) {
                    changeSet[attribute] =
                      currentAttribute instanceof Date
                        ? currentAttribute.toISOString()
                        : currentAttribute ?? null;
                  }
                }

                if (!Object.values(changeSet).length) continue;

                const instanceTransactions =
                  typeTransactions?.[ChangeTypeNumber.Update]?.get(modifiedItemId);
                const appliedTransaction = instanceTransactions?.find(x =>
                  equal(x.changes, changeSet)
                );

                if (appliedTransaction) {
                  if (instanceTransactions!.length === 1) {
                    typeTransactions![ChangeTypeNumber.Update]!.delete(modifiedItemId);
                  } else {
                    typeTransactions![ChangeTypeNumber.Update]!.set(
                      modifiedItemId,
                      instanceTransactions!.filter(x => x.id !== appliedTransaction.id)
                    );
                  }
                  continue;
                }

                console.log('Modified from', beforeModifications);
                console.log('Modified   to', afterModifications);

                // We do it there to keep data difference to find appliedTransaction and get proper changeSet
                snapshotRealm.create(type, afterModifications, Realm.UpdateMode.Modified);

                try {
                  realm.create<TransactionScheme>(RealmService.transactionsName, {
                    Id: RealmService.getNewId(),
                    ChangeType: ChangeTypeNumber.Update,
                    InstanceId: modifiedItemId,
                    CreationDate: creationDate,
                    TableName: type,
                    Changes: changeSet,
                  });
                } catch (e) {
                  console.log('Error on modified transaction creation', e);
                }
              }
            });
          });
          console.log(
            '-------------------------------------------------------------------------------------'
          );
        });
        service.registerTypeListener(type);
      } catch (error) {
        console.error(
          `Unable to update the tasks' state, an exception was thrown within the change listener: ${error}`
        );
      }

      return () => {
        service.unRegisterTypeListener(type);
        dataReference.removeAllListeners();
        realmRef.current = null;
        realmSnapshotTempRef.current = null;
        service.close();
      };
    });
  }, []);

  return { data, realm: realmRef.current, snapshotRealm: realmSnapshotTempRef.current };
}

export function useTransactions() {
  const [data, setData] = useState<(TransactionScheme & Realm.Object)[]>([]);
  useEffect(() => {
    const service = getRealmService();
    service.openIfNeeded().then(({ realm }) => {
      const transactions = realm.objects<TransactionScheme>(RealmService.transactionsName);
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
