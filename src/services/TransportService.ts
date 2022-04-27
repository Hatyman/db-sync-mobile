import * as signalR from '@microsoft/signalr';
import { HubConnectionState, LogLevel } from '@microsoft/signalr';
import { getAxiosFactory, ITransactionDto } from 'services/api/api-client';

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

  constructor(path: string = '/transactions-sync') {
    const getAxios = getAxiosFactory();
    const axios = getAxios();
    this._connection = new signalR.HubConnectionBuilder()
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Information)
      .withUrl((axios?.defaults.baseURL ?? '') + path)
      .build();
    this._connection.on('test', this.onTest);
    this._connection.onclose(this.onClose);
    this._connection.onreconnecting(this.onReconnecting);
    this._connection.onreconnected(this.onReconnected);

    this.connectionPromise = this.openConnection();
  }

  private onTest = (message: string) => {
    console.log('received from hub message', message);
  };

  private onClose = (error?: Error) => {
    console.log('error', error);
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
