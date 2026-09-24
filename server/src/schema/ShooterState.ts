import { Schema, type, MapSchema } from '@colyseus/schema';

export class Player extends Schema {
  @type('number') x = 400;
  @type('number') y = 300;
  @type('number') angle = 0;
  @type('number') hp = 100;
  @type('boolean') alive = true;
  @type('number') kills = 0;
  @type('number') deaths = 0;
  @type('string') name = 'p';
  @type('boolean') ready = false;
  @type('number') streak = 0;
  @type('number') cash = 0;
  @type('number') damage = 0;
  @type('number') shots = 0;
  @type('number') hitsMade = 0;
  @type('number') reloadLeft = 0;
  @type('number') shield = 0;
  @type('number') shieldPts = 0;
  @type('number') speedT = 0;
  @type('string') weapon = 'pistol';
  @type('number') ammo = 0;
  @type('number') pammo = 12;
  @type('number') sammo = 0;
  @type('number') nammo = 0;
  @type('number') lammo = 0;
  @type('boolean') rifle = false;
  @type('boolean') shotgun = false;
  @type('boolean') sniper = false;
  @type('boolean') laser = false;
  @type('boolean') reloading = false;
}

export class Bullet extends Schema {
  @type('string') id = '';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') vx = 0;
  @type('number') vy = 0;
  @type('string') ownerId = '';
  @type('number') life = 1;
  @type('number') dmg = 25;
  @type('string') weapon = 'pistol'; // gun that fired it (drives remote shot audio)
}

export class Pickup extends Schema {
  @type('string') id = '';
  @type('string') kind = 'health'; // health | rifle | ammo
  @type('number') x = 0;
  @type('number') y = 0;
  @type('boolean') active = true;
  @type('number') t = 0; // respawn countdown while inactive
}

export class Brick extends Schema {
  @type('string') id = '';
  @type('number') hp = 3;
}

export class ShooterState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Bullet }) bullets = new MapSchema<Bullet>();
  @type({ map: Pickup }) pickups = new MapSchema<Pickup>();
  @type({ map: Brick }) bricks = new MapSchema<Brick>();
  @type('string') phase: 'lobby' | 'countdown' | 'playing' | 'ended' = 'lobby';
  @type('number') countdown = 0;
  @type('string') hostId = '';
  @type('string') winnerId = '';
  @type('string') winnerName = '';
  @type('number') timeLeft = 0;
  @type('number') killTarget = 15;
}
