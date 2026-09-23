import { Client, Room } from 'colyseus.js';

export class NetClient {
  client = new Client('ws://localhost:2567');
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
