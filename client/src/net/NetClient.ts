import { Client, Room } from 'colyseus.js';
import { SERVER_WS } from './serverUrl';

export class NetClient {
  client = new Client(SERVER_WS);
  room!: Room;
  async create(name: string) {
    this.room = await this.client.create('shooter', { name });
    return this.room;
  }
  async joinById(roomId: string, name: string) {
    this.room = await this.client.joinById(roomId, { name });
    return this.room;
  }
}
