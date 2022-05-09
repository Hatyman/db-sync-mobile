import * as signalR from '@microsoft/signalr';
import { HubConnectionState, LogLevel } from '@microsoft/signalr';
import { getAxiosFactory, ITransactionDto } from 'services/api/api-client';
import { ITransactionNumberDto } from 'services/d';

export type TransactionsReceivedCallback = (transactions: ITransactionNumberDto[]) => void;

type TransportServiceProps = {
  path?: string;
  onTransactionsReceived: TransactionsReceivedCallback;
  lastSyncTransactionId?: string;
  onDisconnect?: (error?: Error) => void;
};

export class TransportService {
  protected _connection: signalR.HubConnection;
  private connectionPromise: Promise<void>;
  private resolveReconnection: (() => void) | null = null;

  public get connectionState() {
    return this._connection.state;
  }
  public get connectionId() {
    return this._connection.connectionId;
  }

  constructor({
    path = '/transactions-sync',
    onTransactionsReceived,
    lastSyncTransactionId,
    onDisconnect,
  }: TransportServiceProps) {
    const getAxios = getAxiosFactory();
    const axios = getAxios();

    const query = lastSyncTransactionId ? `?lastSyncTransactionId=${lastSyncTransactionId}` : '';

    this._connection = new signalR.HubConnectionBuilder()
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Information)
      .withUrl((axios?.defaults.baseURL ?? '') + path + query)
      .build();
    this._connection.on('test', this.onTest);
    this._connection.on('client-received', onTransactionsReceived);
    this._connection.onclose(error => {
      onDisconnect?.(error);
      this.onClose(error);
    });
    this._connection.onreconnecting(this.onReconnecting);
    this._connection.onreconnected(this.onReconnected);

    this.connectionPromise = this.openConnection();
  }

  private onTest = (message: string) => {
    console.log('received from hub message', message);
  };

  private onClose = (error?: Error) => {
    console.log('error', error);
    console.log('Connection was closed');
  };

  private onReconnecting = (error?: Error) => {
    console.log('error', error);
    console.log('Reconnecting...');
    this.connectionPromise = new Promise<void>(resolve => {
      this.resolveReconnection = resolve;
    });
  };

  private onReconnected = (connectionId?: string) => {
    console.log('Reconnected: ', connectionId);
    this.resolveReconnection?.();
  };

  public openConnection = (): Promise<void> => {
    return this._connection.start();
  };

  public closeConnection = (): Promise<void> => {
    return this._connection.stop();
  };

  public invokeTest = async <T>(message: string): Promise<T> => {
    await this.openConnectionIfNeeded();
    return await this._connection.invoke<T>('Send', message);
  };

  public sendFakeTransactions = async (): Promise<void> => {
    await this.openConnectionIfNeeded();
    return this._connection.send('SendFakeTransactions');
  };

  public invokeTransactions = async (transactions: ITransactionDto[]) => {
    await this.openConnectionIfNeeded();
    return await this._connection.invoke<string[]>('SyncTransactions', transactions);
  };

  public sendTest = async (message: string): Promise<void> => {
    await this.openConnectionIfNeeded();
    return this._connection.send('Send', message);
  };

  private openConnectionIfNeeded = async (): Promise<void> => {
    switch (this.connectionState) {
      case HubConnectionState.Disconnected:
        this.connectionPromise = this.openConnection();
        return this.connectionPromise;
      case HubConnectionState.Reconnecting:
      case HubConnectionState.Connecting:
        return this.connectionPromise;
      case HubConnectionState.Connected:
        return;
      case HubConnectionState.Disconnecting:
        await this._connection.stop();
        this.connectionPromise = this.openConnection();
        return this.connectionPromise;
    }
  };
}
