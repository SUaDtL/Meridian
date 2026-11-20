import type { DiagramTemplate } from '../types';

export const TEMPLATES: DiagramTemplate[] = [
  {
    id: 'edge-to-cloud',
    title: 'Edge to cloud',
    category: 'Architecture',
    description: 'A connected system, from endpoint to services.',
    subtitle: 'From field endpoints to core services.',
    theme: 'obsidian',
    source: `flowchart LR
    endpoint([Field endpoint]) --> gateway[Edge gateway]

    subgraph core["CORE SERVICES"]
        policy[Policy engine]
        stream[[Event stream]]
        store[(Data store)]
        observe[Observability]
    end

    gateway -->|Authorize| policy
    gateway -->|Publish| stream
    gateway -->|Persist| store
    gateway -.->|Telemetry| observe

    classDef default font-size:18px`,
  },
  {
    id: 'platform',
    title: 'A platform in layers',
    category: 'Architecture',
    description: 'A web platform with a separate asynchronous work path.',
    subtitle: 'A small surface. A clear separation of responsibilities.',
    theme: 'blueprint',
    source: `flowchart TB
    browser([Web client]) --> edge[CDN and edge cache]
    edge --> api[API gateway]

    subgraph platform["APPLICATION PLATFORM"]
        direction LR
        auth[Identity service]
        app[Application service]
        queue[[Work queue]]
    end

    api --> auth
    api --> app
    app --> queue
    queue --> workers[Background workers]
    app --> database[(Primary database)]
    workers --> storage[(Object storage)]
    workers -.->|Status update| database`,
  },
  {
    id: 'release-pipeline',
    title: 'From commit to confidence',
    category: 'Delivery',
    description: 'Parallel checks, one release gate, and a measured rollout.',
    subtitle: 'Build once. Verify together. Release deliberately.',
    theme: 'moss',
    source: `flowchart TB
    commit([Commit]) --> build[Build artifact]
    build --> tests[Automated tests]
    build --> security[Security checks]
    tests --> gate{Checks passed?}
    security --> gate
    gate -->|Yes| staging[Deploy to staging]
    gate -->|No| fix[Review and fix]
    fix -.-> commit
    staging --> approve{Approve release?}
    approve -->|Yes| canary[Canary rollout]
    canary --> verify{Healthy?}
    verify -->|Yes| production([Production])
    verify -->|No| rollback[Roll back]`,
  },
  {
    id: 'request-lifecycle',
    title: 'A request, end to end',
    category: 'Sequence',
    description: 'Authentication, a cache hit, and a database fallback.',
    subtitle: 'What happens between the click and the response.',
    theme: 'porcelain',
    source: `sequenceDiagram
    autonumber
    actor User
    participant Web as Web app
    participant API as API service
    participant Cache
    participant DB as Database

    User->>Web: Open workspace
    Web->>API: Request workspace with session
    API->>API: Validate session
    API->>Cache: Read workspace
    alt Cache hit
        Cache-->>API: Cached workspace
    else Cache miss
        Cache-->>API: No cached value
        API->>DB: Query workspace
        DB-->>API: Workspace data
        API->>Cache: Store result
    end
    API-->>Web: Workspace response
    Web-->>User: Ready to work`,
  },
  {
    id: 'change-lifecycle',
    title: 'The shape of a change',
    category: 'State',
    description: 'A lifecycle with review, revision, deployment, and rollback.',
    subtitle: 'Every transition has a reason. Every state has a next step.',
    theme: 'dusk',
    source: `stateDiagram-v2
    direction TB
    [*] --> Draft
    Draft --> Review: Submit
    Review --> Draft: Request changes
    Review --> Approved: Accept
    Approved --> Scheduled: Pick a window
    Scheduled --> Deploying: Start deployment
    Deploying --> Validating: Deployment complete
    Validating --> Complete: Health checks pass
    Validating --> Rollback: Health checks fail
    Deploying --> Rollback: Deployment fails
    Rollback --> Draft: Restore and revise
    Complete --> [*]`,
  },
  {
    id: 'data-model',
    title: 'A shared workspace',
    category: 'Data model',
    description: 'Projects, members, diagrams, and version history.',
    subtitle: 'A compact model for a collaborative diagram workspace.',
    theme: 'porcelain',
    source: `erDiagram
    WORKSPACE ||--o{ PROJECT : contains
    WORKSPACE ||--o{ MEMBERSHIP : grants
    USER ||--o{ MEMBERSHIP : holds
    PROJECT ||--o{ DIAGRAM : groups
    DIAGRAM ||--o{ VERSION : records
    USER ||--o{ VERSION : creates

    WORKSPACE {
        string id PK
        string name
    }
    USER {
        string id PK
        string display_name
    }
    MEMBERSHIP {
        string workspace_id FK
        string user_id FK
        string role
    }
    PROJECT {
        string id PK
        string workspace_id FK
        string name
    }
    DIAGRAM {
        string id PK
        string project_id FK
        string title
    }
    VERSION {
        string id PK
        string diagram_id FK
        string author_id FK
        datetime created_at
    }`,
  },
  {
    id: 'system-map',
    title: 'Think in systems',
    category: 'Mind map',
    description: 'A starting point for a balanced architecture conversation.',
    subtitle: 'The questions behind a system that people can depend on.',
    theme: 'ember',
    source: `mindmap
  root((A resilient system))
    People
      Clear ownership
      Useful documentation
      Practiced response
    Delivery
      Small changes
      Repeatable builds
      Safe rollback
    Operations
      Observable behavior
      Defined objectives
      Tested recovery
    Design
      Explicit boundaries
      Failure isolation
      Simple interfaces`,
  },
  {
    id: 'delivery-roadmap',
    title: 'A deliberate delivery',
    category: 'Timeline',
    description: 'A sample six-week roadmap with dependencies and milestones.',
    subtitle: 'An illustrative plan from discovery to the first release.',
    theme: 'blueprint',
    source: `gantt
    dateFormat YYYY-MM-DD
    axisFormat %b %d
    excludes weekends

    section Understand
    Define the problem       :done, discover, 2026-12-01, 4d
    Agree on success         :done, success, after discover, 2d

    section Build
    Core workflow            :active, core, after success, 8d
    Visual refinement        :visual, after success, 6d
    Export and persistence   :exports, after core, 4d

    section Validate
    End-to-end review        :review, after exports, 3d
    First release            :milestone, release, after review, 0d`,
  },
  {
    id: 'decision-tree',
    title: 'Choose the next step',
    category: 'Decision',
    description: 'A small operational decision tree with clear outcomes.',
    subtitle: 'Start with the impact. Follow the evidence.',
    theme: 'obsidian',
    source: `flowchart TB
    alert([A service alert arrives]) --> impact{Users affected?}
    impact -->|No| observe[Record and observe]
    impact -->|Yes| change{Recent change?}
    change -->|Yes| rollback{Safe to roll back?}
    change -->|No| isolate[Isolate the failing component]
    rollback -->|Yes| restore[Restore the previous version]
    rollback -->|No| isolate
    restore --> check{Service healthy?}
    isolate --> mitigate[Apply a targeted mitigation]
    mitigate --> check
    check -->|Yes| followup([Document and follow up])
    check -->|No| escalate[Bring in the service owner]`,
  },
  {
    id: 'object-model',
    title: 'A diagram, modeled',
    category: 'Classes',
    description: 'A small class model separating source from presentation.',
    subtitle: 'Keep the meaning stable. Let the presentation change.',
    theme: 'dusk',
    source: `classDiagram
    direction TB
    class Document {
        +String title
        +String source
        +Settings settings
        +render()
        +save()
    }
    class Settings {
        +String theme
        +String layout
        +String motion
    }
    class Renderer {
        +parse(source)
        +layout(graph)
        +draw(graph, settings)
    }
    class Exporter {
        +toSVG(diagram)
        +toPNG(diagram)
    }
    Document *-- Settings : includes
    Document --> Renderer : renders with
    Renderer --> Exporter : supplies diagram`,
  },
];
