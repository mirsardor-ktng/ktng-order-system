export interface PermissionDef {
  code: string;
  name: string;
  description: string;
}

export interface PermissionGroup {
  id: string;
  name: string;
  description: string;
  permissions: PermissionDef[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'users',
    name: 'Пользователи & Доступ',
    description: 'Управление учетными записями пользователей и правами',
    permissions: [
      { code: 'users:read', name: 'Просмотр пользователей', description: 'Доступ к списку пользователей системы' },
      { code: 'users:manage', name: 'Управление пользователями', description: 'Создание, редактирование, блокировка и удаление пользователей' },
      { code: 'roles:manage', name: 'Управление ролями', description: 'Создание, настройка шаблонов ролей и матрицы прав' }
    ]
  },
  {
    id: 'companies',
    name: 'Компании & Контрагенты',
    description: 'Управление контрагентами и их планами закупок',
    permissions: [
      { code: 'companies:read', name: 'Просмотр компаний', description: 'Просмотр списка компаний и их реквизитов' },
      { code: 'companies:manage', name: 'Управление компаниями', description: 'Создание, редактирование компаний, планов закупок и таргетов' }
    ]
  },
  {
    id: 'products',
    name: 'Каталог & Склад',
    description: 'Товары, складские остатки, группы SKU и теги',
    permissions: [
      { code: 'products:read', name: 'Просмотр каталога', description: 'Просмотр списка товаров, цен и остатков' },
      { code: 'products:manage', name: 'Полное управление каталогом', description: 'Добавление, редактирование цен, названий и удаление SKU' },
      { code: 'products:stock_update', name: 'Изменение остатков склада', description: 'Разрешение обновлять только количество пачек на складе' },
      { code: 'product_groups:manage', name: 'Управление группами товаров', description: 'Создание и настройка логических групп продукции' },
      { code: 'tags:manage', name: 'Управление тегами', description: 'Создание и привязка цветовых тегов к товарам' }
    ]
  },
  {
    id: 'orders',
    name: 'Заказы & Продажи',
    description: 'Оформление, просмотр и обработка B2B заказов',
    permissions: [
      { code: 'orders:view_all', name: 'Просмотр всех заказов', description: 'Просмотр заказов всех клиентов и компаний системы' },
      { code: 'orders:view_own', name: 'Просмотр заказов своей компании', description: 'Просмотр заказов, оформленных для своей компании' },
      { code: 'orders:create', name: 'Оформление заказов', description: 'Создание новых заказов (корзина / консоль продаж)' },
      { code: 'orders:edit', name: 'Редактирование заказов', description: 'Внесение правок в существующие заказы' },
      { code: 'orders:status_change', name: 'Смена статусов заказов', description: 'Перевод заказов в статусы DRAFT, SENT, COMPLETED, CANCELLED' },
      { code: 'orders:comments', name: 'Комментирование заказов', description: 'Оставление заметок и комментариев к заказам' },
      { code: 'orders:export', name: 'Выгрузка в Excel', description: 'Генерация и скачивание сформированных Excel бланков заказов' }
    ]
  },
  {
    id: 'promotions',
    name: 'Акции & Скидки',
    description: 'Маркетинговые программы, бонусы и финансовые скидки',
    permissions: [
      { code: 'promotions:read', name: 'Просмотр акций', description: 'Просмотр действующих бонусных и скидочных программ' },
      { code: 'promotions:manage', name: 'Управление акциями', description: 'Создание, настройка и отключение промо-акций' }
    ]
  },
  {
    id: 'analytics',
    name: 'Аналитика & Отчеты',
    description: 'Дашборды продаж, графики и динамика клиентов',
    permissions: [
      { code: 'analytics:view', name: 'Просмотр аналитики', description: 'Доступ к дашборду аналитики, графикам и отчетам по клиентам и SKU' }
    ]
  },
  {
    id: 'templates',
    name: 'Шаблоны & Интеграции',
    description: 'Шаблоны документов, сопоставление полей и импорт',
    permissions: [
      { code: 'templates:manage', name: 'Управление Excel шаблонами', description: 'Загрузка и активация типовых бланков' },
      { code: 'placeholders:manage', name: 'Маппинг полей шаблона', description: 'Настройка соответствия тегов {PLACEHOLDER} полям базы данных' },
      { code: 'import:execute', name: 'Импорт истории заказов', description: 'Массовая загрузка исторических заказов из файлов' }
    ]
  },
  {
    id: 'system',
    name: 'Система & Безопасность',
    description: 'Журналы событий и резервное копирование',
    permissions: [
      { code: 'logs:view', name: 'Просмотр журнала аудита', description: 'Анализ логов действий пользователей и системных событий' },
      { code: 'settings:manage', name: 'Настройки системы & GDrive', description: 'Управление облачной синхронизацией Google Drive и ключами' }
    ]
  }
];

export const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.code));

export interface DefaultRoleDefinition {
  name: string;
  description: string;
  isSystem: boolean;
  defaultDashboard: string;
  permissions: string[];
}

export const DEFAULT_ROLE_TEMPLATES: DefaultRoleDefinition[] = [
  {
    name: 'Суперадминистратор',
    description: 'Полный неограниченный доступ ко всем модулям и настройкам системы',
    isSystem: true,
    defaultDashboard: '/admin',
    permissions: ALL_PERMISSIONS
  },
  {
    name: 'Менеджер продаж',
    description: 'Работа в консоли продаж, создание и редактирование заказов, просмотр аналитики и каталога',
    isSystem: true,
    defaultDashboard: '/seller',
    permissions: [
      'orders:view_all',
      'orders:create',
      'orders:edit',
      'orders:status_change',
      'orders:comments',
      'orders:export',
      'products:read',
      'products:stock_update',
      'companies:read',
      'promotions:read',
      'analytics:view'
    ]
  },
  {
    name: 'Клиент B2B (Заказчик)',
    description: 'Оформление оптовых заказов своей компании, просмотр каталога и доступных акций',
    isSystem: true,
    defaultDashboard: '/customer',
    permissions: [
      'orders:view_own',
      'orders:create',
      'orders:comments',
      'products:read',
      'promotions:read'
    ]
  },
  {
    name: 'Ограниченный менеджер',
    description: 'Просмотр каталога, акций и комментирование заказов без прав на смену цен и настроек',
    isSystem: true,
    defaultDashboard: '/seller',
    permissions: [
      'orders:view_all',
      'orders:comments',
      'products:read',
      'promotions:read'
    ]
  }
];
