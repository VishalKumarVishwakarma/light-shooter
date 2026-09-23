# UML Documentation
### Complete UML diagram set for the multiplayer 2D shooter

This file contains all standard UML diagram types relevant to this project, rendered as Mermaid diagrams (viewable directly in the markdown preview) with explanations for each.

---

## 1. Use Case Diagram
Shows what actors (Player, Host, Server) can do in the system.

```mermaid
graph TB
    Player((Player))
    Host((Host Player))
    Server((Game Server))

    Player --> UC1[Enter Name]
    Player --> UC2[Create Room]
    Player --> UC3[Join Room via Code/Link]
    Player --> UC4[Move Character]
    Player --> UC5[Aim & Shoot]
    Player --> UC6[Reload Weapon]
    Player --> UC7[Collect Pickup]
    Player --> UC8[View Scoreboard]
    Player --> UC9[Respawn After Death]
    Player --> UC10[View Match Results]
    Player --> UC11[Rematch / Leave]

    Host --> UC2
    Host --> UC12[Start Match]
    Host --> UC13[Kick Player - stretch]

    Server --> UC14[Validate Movement/Shots]
    Server --> UC15[Broadcast Game State]
    Server --> UC16[Apply Damage & Death Logic]
    Server --> UC17[Manage Room Lifecycle]
    Server --> UC18[Handle Disconnect/Reconnect]
```

**Key actors:**
- **Player** — any connected client; the primary actor.
- **Host** — the player who created the room; has slightly elevated privileges (start match).
- **Game Server** — a system actor that drives authoritative logic, not a human, but essential to model since it "acts" on every gameplay use case.

---

## 2. Class Diagram
Core domain model — the objects your code will actually be built around, client and server side.

```mermaid
classDiagram
    class Room {
        +String code
        +String hostId
        +String status
        +Map~String,Player~ players
        +GameMode mode
        +MapData map
        +Number startTime
        +createRoom()
        +addPlayer(player)
        +removePlayer(playerId)
        +startMatch()
        +endMatch()
        +broadcastState()
    }

    class Player {
        +String id
        +String name
        +Number x
        +Number y
        +Number health
        +Weapon currentWeapon
        +Number kills
        +Number deaths
        +Boolean isAlive
        +Boolean isHost
        +move(dx, dy)
        +shoot(angle)
        +takeDamage(amount)
        +respawn()
        +reload()
    }

    class Weapon {
        +String id
        +String name
        +Number damage
        +Number fireRate
        +Number ammoCapacity
        +Number currentAmmo
        +Number reloadTime
        +Number range
        +fire()
        +reload()
    }

    class Bullet {
        +String ownerId
        +Number x
        +Number y
        +Number angle
        +Number speed
        +Number damage
        +update(deltaTime)
        +checkCollision(players)
    }

    class Pickup {
        +String id
        +String type
        +Number x
        +Number y
        +Boolean isActive
        +Number respawnTimer
        +onCollected(player)
        +respawn()
    }

    class MapData {
        +String id
        +Platform[] platforms
        +SpawnPoint[] spawnPoints
        +PickupSpawn[] pickupSpawns
        +Bounds boundaries
    }

    class GameServer {
        +Map~String,Room~ rooms
        +Number tickRate
        +createRoom(hostId)
        +getRoom(code)
        +tick()
        +handleInput(playerId, input)
        +handleDisconnect(playerId)
    }

    class InputMessage {
        +String type
        +Number seq
        +Number timestamp
        +Object payload
    }

    Room "1" *-- "2..8" Player : contains
    Room "1" --> "1" MapData : uses
    Player "1" --> "1" Weapon : holds
    Player "1" --> "0..*" Bullet : fires
    Room "1" --> "0..*" Pickup : spawns
    GameServer "1" *-- "0..*" Room : manages
    Player ..> InputMessage : sends
```

---

## 3. Sequence Diagram — Joining a Room
Shows the message flow when a second player joins via a shared link.

```mermaid
sequenceDiagram
    actor P2 as Player 2
    participant FE as Frontend (Client)
    participant API as Lobby API (REST)
    participant WS as Game Server (WebSocket)
    participant Room as Room Instance

    P2->>FE: Open shared link (/room/ABCD12)
    FE->>API: GET /rooms/ABCD12
    API->>Room: Check room exists & has space
    Room-->>API: Room status: waiting, 1/4 players
    API-->>FE: Room info (players list, status)
    FE-->>P2: Show lobby screen with Player 1 already in

    P2->>FE: Enter name, click "Join"
    FE->>API: POST /rooms/ABCD12/join
    API->>Room: addPlayer(Player2)
    Room-->>API: Session token issued
    API-->>FE: Token + confirmation
    FE->>WS: Open WebSocket connection (with token)
    WS->>Room: Authenticate & attach socket
    Room-->>WS: Player2 added to room state
    WS-->>FE: Broadcast updated player list
    WS-->>P2: Lobby updated: "Player 2 joined"
    Note over Room,WS: Once 2+ players ready, host triggers Start Match
```

---

## 4. Sequence Diagram — Shooting & Damage (Server-Authoritative)
Shows how a "real rule" (damage) is enforced end-to-end.

```mermaid
sequenceDiagram
    actor A as Player A (Shooter)
    participant FEA as Client A
    participant WS as Game Server
    participant Room as Room State
    participant FEB as Client B
    actor B as Player B (Target)

    A->>FEA: Click/tap to shoot
    FEA->>FEA: Client-side prediction (show bullet immediately)
    FEA->>WS: send {type: "shoot", angle, weaponId, timestamp}
    WS->>Room: Validate ammo, fire rate, position
    alt Valid shot
        Room->>Room: Simulate bullet trajectory
        Room->>Room: Check collision vs all players
        alt Hits Player B
            Room->>Room: Apply damage to Player B
            alt Health <= 0
                Room->>Room: Mark Player B dead, start respawn timer
            end
            Room-->>WS: State update (health, kill feed event)
            WS-->>FEA: Broadcast: hit confirmed + kill feed
            WS-->>FEB: Broadcast: damage taken, update health bar
            FEB-->>B: Screen flash, health bar drops
        else Miss
            Room-->>WS: State update (bullet traveled, no hit)
            WS-->>FEA: Broadcast bullet path
        end
    else Invalid (no ammo / rate-limited)
        WS-->>FEA: Reject shot silently or show "no ammo"
    end
```

---

## 5. State Diagram — Player Lifecycle
Models the "real rules" a player intuitively learns: alive → damaged → dead → respawn.

```mermaid
stateDiagram-v2
    [*] --> Spawning
    Spawning --> Invulnerable : spawn complete
    Invulnerable --> Alive : invulnerability timer ends (1-2s)
    Alive --> Alive : takes damage (health > 0)
    Alive --> Dead : health reaches 0
    Dead --> Spawning : respawn timer elapses (~3s)
    Alive --> [*] : leaves room
    Dead --> [*] : leaves room
```

---

## 6. State Diagram — Room / Match Lifecycle
Models the overall match flow, a "rule" the whole game revolves around.

```mermaid
stateDiagram-v2
    [*] --> Empty
    Empty --> Waiting : first player joins (room created)
    Waiting --> Waiting : player joins/leaves (below min players)
    Waiting --> Countdown : min players (2) reached, host starts
    Countdown --> InProgress : countdown reaches 0
    InProgress --> InProgress : players play, kills tracked
    InProgress --> Ended : kill target reached OR timer expires
    Ended --> Waiting : "Play Again" selected
    Ended --> Closed : all players leave
    Waiting --> Closed : all players leave / timeout
    Closed --> [*]
```

---

## 7. Activity Diagram — Full Player Journey
End-to-end flow from opening the link to seeing results.

```mermaid
flowchart TD
    Start([Player opens URL]) --> Menu[Main Menu]
    Menu --> Choice{Create or Join?}
    Choice -->|Create| CreateRoom[Create Room + Get Link]
    Choice -->|Join| EnterCode[Enter Code / Open Link]
    CreateRoom --> Lobby[Lobby Screen]
    EnterCode --> ValidRoom{Room Valid & Has Space?}
    ValidRoom -->|No| Error[Show Error: Full/Not Found]
    Error --> Menu
    ValidRoom -->|Yes| Lobby
    Lobby --> Wait{2+ Players Ready?}
    Wait -->|No| Lobby
    Wait -->|Yes| Countdown[Countdown 3-2-1]
    Countdown --> Match[In-Match Loop]
    Match --> Move[Move / Aim / Shoot]
    Move --> Server{Server Validates}
    Server -->|Valid| Update[Broadcast State to All Clients]
    Server -->|Invalid| Ignore[Ignore/Reject Input]
    Update --> CheckEnd{Kill Target Hit OR Timer Expired?}
    Ignore --> CheckEnd
    CheckEnd -->|No| Match
    CheckEnd -->|Yes| Results[Post-Match Results Screen]
    Results --> Again{Play Again?}
    Again -->|Yes| Lobby
    Again -->|No| Menu
```

---

## 8. Component Diagram — System Architecture
High-level software components and how they communicate.

```mermaid
flowchart LR
    subgraph Client["Client (Browser - Desktop/Mobile)"]
        UI[UI Layer<br/>Menu, HUD, Settings]
        Renderer[Game Renderer<br/>Canvas/WebGL]
        InputHandler[Input Handler<br/>Keyboard/Touch/Mouse]
        Prediction[Client Prediction<br/>& Interpolation]
        SocketClient[WebSocket Client]
    end

    subgraph Backend["Backend Server"]
        LobbyAPI[Lobby REST API]
        SocketServer[WebSocket Server]
        GameLoop[Authoritative Game Loop<br/>Tick Engine]
        RoomManager[Room Manager]
        AntiCheat[Input Validation /<br/>Anti-Cheat Checks]
    end

    subgraph Infra["Infrastructure"]
        Hosting[Cloud Host<br/>Render/Railway/Fly.io]
        Redis[(Redis - stretch<br/>Room Registry)]
        DB[(Database - stretch<br/>Stats/Leaderboard)]
    end

    UI --> InputHandler
    InputHandler --> Prediction
    Prediction --> SocketClient
    SocketClient <--> SocketServer
    UI <--> LobbyAPI
    Renderer --> UI

    SocketServer --> GameLoop
    GameLoop --> RoomManager
    GameLoop --> AntiCheat
    RoomManager --> Redis
    GameLoop --> DB
    LobbyAPI --> RoomManager

    Backend --> Hosting
```

---

## 9. Deployment Diagram
Physical/hosting view — where each piece actually runs.

```mermaid
flowchart TB
    subgraph DeviceA["Player A's Device"]
        BrowserA[Browser: Game Client]
    end
    subgraph DeviceB["Player B's Device"]
        BrowserB[Browser: Game Client]
    end

    subgraph CDN["CDN / Static Hosting"]
        StaticAssets[HTML/JS/CSS/Sprites/Audio]
    end

    subgraph GameServerNode["Cloud VM / Container"]
        Node[Node.js Process<br/>Socket.IO + Express]
        Rooms[In-Memory Room State]
    end

    subgraph OptionalInfra["Stretch Infra"]
        RedisNode[(Redis)]
        DBNode[(PostgreSQL/Mongo)]
    end

    BrowserA -- HTTPS --> StaticAssets
    BrowserB -- HTTPS --> StaticAssets
    BrowserA -- WSS --> Node
    BrowserB -- WSS --> Node
    Node --> Rooms
    Node -.optional.-> RedisNode
    Node -.optional.-> DBNode
```

---

## 10. How These Diagrams Map to Your Requirements

| Requirement | Diagram(s) that address it |
|---|---|
| "At least two players from separate devices" | Deployment Diagram, Sequence: Joining a Room, Component Diagram |
| "Real rules a player could follow without explanation" | Player State Diagram, Room/Match State Diagram, Class Diagram (Weapon/Player/Pickup rules baked into structure) |
| "Live at a URL others can reach" | Deployment Diagram, Component Diagram |
| Core gameplay logic (shoot, damage, death) | Sequence: Shooting & Damage, Class Diagram, Activity Diagram |

---

## 11. Notes on Using These Diagrams

- These are **design-level** UML — intended to guide implementation, not to be exhaustively complete before you write code. Expect the Class Diagram especially to evolve once you start building.
- The **Class Diagram** is client/server agnostic here — in practice, you'll likely have a server-side authoritative version of `Player`/`Room`/`Bullet` and a lighter client-side rendering counterpart; split that once implementation starts.
- All diagrams render natively wherever GitHub-flavored Markdown + Mermaid is supported (GitHub, many IDEs, Notion, this chat's markdown preview).
