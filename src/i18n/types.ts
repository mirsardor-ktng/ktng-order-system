export type Language = 'ru' | 'uz' | 'en';

export interface CommonTranslations {
  save: string;
  cancel: string;
  delete: string;
  edit: string;
  create: string;
  back: string;
  close: string;
  search: string;
  filter: string;
  all: string;
  status: string;
  actions: string;
  loading: string;
  empty: string;
  refresh: string;
  confirm: string;
  yes: string;
  no: string;
  download: string;
  total: string;
  details: string;
  apply: string;
  reset: string;
  error: string;
  success: string;
  notFound: string;
  add: string;
  unknown: string;
}

export interface AuthTranslations {
  systemTitle: string;
  systemSubtitle: string;
  emailLabel: string;
  emailPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  signInButton: string;
  signingIn: string;
  checkingSession: string;
  invalidCredentials: string;
  fillAllFields: string;
  networkError: string;
  adminRole: string;
  adminRoleDesc: string;
  sellerRole: string;
  sellerRoleDesc: string;
  customerRole: string;
  customerRoleDesc: string;
  logout: string;
  loggingOut: string;
  sessionExpired: string;
}

export interface NavigationTranslations {
  catalog: string;
  orderHistory: string;
  analytics: string;
  profile: string;
  adminConsole: string;
  sellerConsole: string;
  b2bWholesale: string;
  supplyPortal: string;
  orderControl: string;
  orderManagement: string;
  dashboard: string;
  users: string;
  roles: string;
  companies: string;
  promotions: string;
  productGroups: string;
  productsSku: string;
  tags: string;
  excelTemplates: string;
  fieldMapping: string;
  importHistory: string;
  systemLogs: string;
  cloudStorage: string;
}

export interface ProductsTranslations {
  sku: string;
  name: string;
  group: string;
  price: string;
  stock: string;
  available: string;
  outOfStock: string;
  packs: string;
  block: string;
  blocks: string;
  pieces: string;
  status: string;
  active: string;
  inactive: string;
  searchPlaceholder: string;
  allGroups: string;
  cartEmpty: string;
  cartTitle: string;
  clearCart: string;
  addToCart: string;
  quantity: string;
  itemAdded: string;
  noProductsFound: string;
  pricePerBlock: string;
}

export interface OrdersTranslations {
  title: string;
  historyTitle: string;
  newOrder: string;
  draft: string;
  submitted: string;
  confirmed: string;
  processing: string;
  shipped: string;
  delivered: string;
  cancelled: string;
  statusNew: string;
  statusDraft: string;
  statusConfirmed: string;
  statusProcessing: string;
  statusAssembly: string;
  statusShipped: string;
  statusDelivered: string;
  statusCompleted: string;
  statusCancelled: string;
  orderNumber: string;
  orderDate: string;
  customer: string;
  items: string;
  totalSum: string;
  baseTotal: string;
  discountTotal: string;
  finalTotal: string;
  checkoutButton: string;
  confirmOrder: string;
  orderCreatedSuccess: string;
  orderCancelledSuccess: string;
  cancelConfirmation: string;
  emptyOrders: string;
  viewDetails: string;
  downloadExcel: string;
  orderSummary: string;
  submittingOrder: string;
  effectivePrice: string;
  basePrice: string;
  discount: string;
  bonusItem: string;
  bonusFromPromo: string;
  comment: string;
  commentPlaceholder: string;
  sendComment: string;
  commentAdded: string;
  commentAddError: string;
  loadingHistory: string;
}

export interface UnitsTranslations {
  packs: string;
  blocks: string;
  cases: string;
  packsShort: string;
  blocksShort: string;
  casesShort: string;
  perPack: string;
  perBlock: string;
  perCase: string;
  pricePerUnit: string;
  pieces: string;
}

export interface DashboardTranslations {
  lastOrder: string;
  noOrders: string;
  firstOrderCall: string;
  totalPurchaseVolume: string;
  totalPurchaseDesc: string;
  shippedProducts: string;
  casesUnit: string;
  blocksShippedDesc: string;
  currentMonthPlan: string;
  planNotSet: string;
}

export interface CatalogTranslations {
  tags: string;
  bonusesGranted: string;
  giftVolume: string;
  orderSavings: string;
  selected: string;
  bonus: string;
  total: string;
  sum: string;
  promotionDiscount: string;
  free: string;
  from: string;
  calculatingPromotions: string;
  stockLimitExceeded: string;
  stockLimitReached: string;
  outOfStock: string;
}

export interface AnalyticsTranslations {
  title: string;
  customerSubtitle: string;
  generalSubtitle: string;
  averageOrder: string;
  lastOrder: string;
  daysAgo: string;
  dayAgo: string;
  daysAgoFew: string;
  noData: string;
  favoriteProduct: string;
  ofYourOrders: string;
  topGrowingProduct: string;
  favoriteSkuShare: string;
  accountsFor: string;
  averageCheckDynamics: string;
  comparedToLastMonth: string;
  casesPurchased: string;
  allTime: string;
  thisYear: string;
  thisMonth: string;
  ordersHistory: string;
  orders: string;
  revenue: string;
  averageCheck: string;
  totalCases: string;
  avgCases: string;
  avgSkus: string;
  uniqueSkus: string;
  monthlyDynamics: string;
  clickToDetail: string;
  detailFor: string;
  ordersHistoryFor: string;
  skuSalesAll: string;
  dealerRankings: string;
  dealer: string;
  loading: string;
  skuSalesDetail: string;
  searchSkuPlaceholder: string;
  noProducts: string;
  tableSku: string;
  tableName: string;
  tableCases: string;
  tableRevenue: string;
  tableShare: string;
  tableGrowth: string;
  pageOf: string;
  tooltipRevenue: string;
  tooltipOrders: string;
  tooltipCases: string;
  millionShort: string;
  thousandShort: string;
}

export interface PromotionsTranslations {
  title: string;
  createPromo: string;
  editPromo: string;
  activePromos: string;
  type: string;
  typeSkuBonus: string;
  typePercentage: string;
  typeFixedAmount: string;
  discountPercent: string;
  fixedDiscount: string;
  bonusSku: string;
  sameSku: string;
  anotherSku: string;
  minPacks: string;
  bonusPacks: string;
  validUntil: string;
  promoApplied: string;
  appliedBadge: string;
  bonusItemNotice: string;
}

export interface ProfileTranslations {
  title: string;
  userInfo: string;
  name: string;
  email: string;
  company: string;
  role: string;
  security: string;
  changePassword: string;
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
  passwordMismatch: string;
  passwordMinLength: string;
  passwordSuccess: string;
  saveChanges: string;
}

export interface ErrorsTranslations {
  customerNotFound: string;
  insufficientStock: string;
  bonusStockInsufficient: string;
  invalidOrder: string;
  promotionNotAvailable: string;
  networkError: string;
  unauthorized: string;
  accessDenied: string;
  unknownError: string;
  fillRequiredFields: string;
  invalidNumber: string;
}

export interface SellerTranslations {
  incomingOrders: string;
  skuMonitoring: string;
  totalSalesVolume: string;
  activeOrdersSum: string;
  casesShipped: string;
  casesConversionHint: string;
  blocksShipped: string;
  blocksConversionHint: string;
  activeClients: string;
  companiesCount: string;
  madeAtLeastOneOrder: string;
  searchOrdersPlaceholder: string;
  period: string;
  today: string;
  week: string;
  incomingOrdersJournal: string;
  ordersNotFound: string;
  ordersNotFoundDesc: string;
  dealSum: string;
  purchaseList: string;
  noCommentsYet: string;
  volume: string;
  editOrder: string;
  editOrderItemsTitle: string;
  changeStatus: string;
  noExcel: string;
  downloadExcel: string;
  catalogMonitoring: string;
  catalogMonitoringDesc: string;
  searchCatalogPlaceholder: string;
  tableCover: string;
  pricePerPack: string;
  pricePerBlock: string;
  stockBalance: string;
  showcase: string;
  actions: string;
  statusActive: string;
  statusHidden: string;
  editStock: string;
  editStockTitle: string;
  editStockModalTitle: string;
  product: string;
  newStockPacksLabel: string;
  inBlocks: string;
  inCases: string;
  saveStock: string;
  editOrderModalTitle: string;
  orderItemsHeader: string;
  bonusFree: string;
  removeItemTitle: string;
  quantityBlocksLabel: string;
  pricePerPackLabel: string;
  makePaid: string;
  makeBonus: string;
  itemTotalLabel: string;
  giftZeroSum: string;
  selectProductToAdd: string;
  totalBlocksSummary: string;
  totalPacksSummary: string;
  recalculatedOrderTotal: string;
  saveChanges: string;
  statusUpdated: string;
  statusUpdateError: string;
  stockUpdated: string;
  stockUpdateError: string;
  atLeastOneItemRequired: string;
  specifyQuantityError: string;
  orderUpdatedSuccess: string;
  orderUpdateError: string;
  networkError: string;
}

export interface Dictionary {
  common: CommonTranslations;
  auth: AuthTranslations;
  navigation: NavigationTranslations;
  products: ProductsTranslations;
  orders: OrdersTranslations;
  seller: SellerTranslations;
  units: UnitsTranslations;
  dashboard: DashboardTranslations;
  catalog: CatalogTranslations;
  analytics: AnalyticsTranslations;
  promotions: PromotionsTranslations;
  profile: ProfileTranslations;
  errors: ErrorsTranslations;
}
