import {
  addCurrencyWallet,
  renameCurrencyWallet,
  setCurrencyWalletTxMetadata
} from '../redux/actions.js'
import {
  getCurrencyWalletEngine,
  getCurrencyWalletName,
  getCurrencyWalletPlugin,
  getCurrencyWalletTxs
} from '../redux/selectors.js'
import { makeStorageWalletApi } from '../storage/storageApi.js'
import { copyProperties, wrapObject } from '../util/api.js'
import { createReaction } from '../util/reaction.js'
import { compare } from '../util/recycle.js'
import { filterObject } from '../util/util.js'

function nop () {}

const fakeMetadata = {
  payeeName: '',
  category: '',
  notes: '',
  amountFiat: 0,
  bizId: 0
}

/**
 * Creates a `CurrencyWallet` API object.
 */
export function makeCurrencyWallet (keyInfo, opts) {
  const { io, callbacks = {} } = opts
  const { redux } = io

  return redux
    .dispatch(addCurrencyWallet(keyInfo, opts))
    .then(keyId =>
      wrapObject(
        io.onError,
        'CurrencyWallet',
        makeCurrencyApi(redux, keyInfo, callbacks)
      )
    )
}

/**
 * Creates an unwrapped account API object around an account state object.
 */
export function makeCurrencyApi (redux, keyInfo, callbacks) {
  const { dispatch, getState } = redux
  const keyId = keyInfo.id

  // Bound selectors:
  const engine = () => getCurrencyWalletEngine(getState(), keyId)
  const plugin = () => getCurrencyWalletPlugin(getState(), keyId)

  const {
    // onAddressesChecked = nop,
    // onBalanceChanged = nop,
    // onBlockHeightChanged = nop,
    // onDataChanged = nop,
    onNewTransactions = nop,
    onTransactionsChanged = nop,
    onWalletNameChanged
  } = callbacks

  // Hook up the `onTransactionsChanged` and `onNewTransactions` callbacks:
  dispatch(
    createReaction(
      state => getCurrencyWalletTxs(state, keyId),
      (mergedTxs, oldTxs = {}) => {
        const changes = []
        const created = []

        // Diff the transaction list:
        for (const txid of Object.keys(mergedTxs)) {
          if (!compare(oldTxs[txid], mergedTxs[txid])) {
            if (oldTxs[txid]) changes.push(mergedTxs[txid])
            else created.push(mergedTxs[txid])
          }
        }

        if (changes.length) onTransactionsChanged(changes)
        if (created.length) onNewTransactions(created)
      }
    )
  )

  // Hook up the `onWalletNameChanged` callback:
  if (onWalletNameChanged) {
    dispatch(
      createReaction(
        state => getCurrencyWalletName(state, keyId),
        onWalletNameChanged
      )
    )
  }

  const out = {
    // Storage stuff:
    get name () {
      return getCurrencyWalletName(getState(), keyId)
    },
    renameWallet (name) {
      return dispatch(renameCurrencyWallet(keyId, name))
    },

    // Currency info:
    get fiatCurrencyCode () {
      return 'USD'
    },
    get currencyInfo () {
      return plugin().getInfo()
    },

    // Running state:
    startEngine () {
      return engine().startEngine()
    },

    stopEngine () {
      return Promise.resolve(engine().killEngine())
    },

    // Transactions:
    '@getBalance': { sync: true },
    getBalance (currencyCode) {
      return engine().getBalance({ currencyCode })
    },

    '@getBlockHeight': { sync: true },
    getBlockHeight () {
      return engine().getBlockHeight()
    },

    getTransactions (opts = {}) {
      const txs = getCurrencyWalletTxs(getState(), keyId)
      return Promise.resolve(Object.keys(txs).map(key => txs[key]))
    },

    getReceiveAddress (opts) {
      return Promise.resolve({
        publicAddress: engine().getFreshAddress(opts),
        amountSatoshi: 0,
        metadata: fakeMetadata
      })
    },

    saveReceiveAddress (receiveAddress) {
      return Promise.resolve()
    },

    lockReceiveAddress (receiveAddress) {
      return Promise.resolve()
    },

    '@makeAddressQrCode': { sync: true },
    makeAddressQrCode (address) {
      return address.publicAddress
    },

    '@makeAddressUri': { sync: true },
    makeAddressUri (address) {
      return address.publicAddress
    },

    makeSpend (spendInfo) {
      return engine().makeSpend(spendInfo)
    },

    signTx (tx) {
      return engine().signTx(tx)
    },

    broadcastTx (tx) {
      return engine().broadcastTx(tx)
    },

    saveTx (tx) {
      return Promise.all([
        engine().saveTx(tx),
        dispatch(
          setCurrencyWalletTxMetadata(
            keyId,
            tx.txid,
            filterObject(tx, ['metadata', 'txid', 'amountSatoshi'])
          )
        )
      ])
    },

    getMaxSpendable (spendInfo) {
      return Promise.resolve(0)
    },

    sweepPrivateKey (keyUri) {
      return Promise.resolve(0)
    }
  }
  copyProperties(out, makeStorageWalletApi(redux, keyInfo, callbacks))

  return out
}