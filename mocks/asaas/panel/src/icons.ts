/**
 * The catalog. EVERY screen imports from here, never from
 * `@hugeicons/core-free-icons` directly.
 *
 * The reason is the same as the rest of the project: there is one place where
 * the decision lives. The package has 13,624 icons, and without this file the
 * Home would pick `UserGroup02` for "customers", the list would pick
 * `UserMultiple03`, and the panel would have three different drawings of the
 * same thing — each one plausible, none of them wrong, and the whole looking
 * like a patchwork.
 *
 * The names here are the CONCEPT ("customer"), not the drawing ("UserGroup02").
 * Changing the drawing later is changing one line.
 */
export {
  Add01Icon as ADD,
  Alert02Icon as ALERT,
  Delete02Icon as DELETE,
  DocumentValidationIcon as NFSE,
  FileScriptIcon as LOG,
  Key01Icon as KEY,
  LockIcon as LOCK,
  PencilEdit02Icon as EDIT,
  SourceCodeIcon as INTEGRATION,
  UserAdd01Icon as PROFILE,
  MagicWand01Icon as GENERATOR,
  ArrowDown01Icon as CARET,
  ArrowDown01Icon as SORT_DESC,
  ArrowReloadHorizontalIcon as REFRESH,
  ArrowRight01Icon as CHEVRON,
  ArrowUp01Icon as SORT_ASC,
  Search01Icon as SEARCH,
  Building03Icon as SUBACCOUNT,
  Cancel01Icon as CLOSE,
  Clock01Icon as CLOCK,
  Copy01Icon as COPY,
  CreditCardIcon as CARD,
  HelpCircleIcon as HELP,
  Home01Icon as HOME,
  InformationCircleIcon as INFO,
  Invoice01Icon as PAYMENT,
  MoneyReceive01Icon as ANTICIPATION,
  Moon02Icon as MOON,
  QrCode01Icon as PIX,
  ReceiptDollarIcon as STATEMENT,
  SharingIcon as SPLIT,
  Store01Icon as STORE,
  Sun02Icon as SUN,
  UserGroupIcon as CUSTOMER,
  WebhookIcon as WEBHOOK,
  WhatsappIcon as WHATSAPP,
  Mail01Icon as MAIL,
} from '@hugeicons/core-free-icons'
