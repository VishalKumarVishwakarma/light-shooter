import { Client, Room } from 'colyseus.js';
import { SERVER_WS } from './serverUrl';

export class NetClient {
  client = new Client(SERVER_WS);
  room!: Room;
  // rooms are opened by the server under a 4-digit code (POST /code) and
  // reached by resolving that code to the internal room id, so host and guest
  // travel the exact same path
  async joinById(roomId: string, name: string) {
    this.room = await this.client.joinById(roomId, { name });
    return this.room;
  }
}
