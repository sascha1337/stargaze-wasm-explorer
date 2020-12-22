import {
  CosmWasmClient as LaunchpadClient,
  CosmWasmFeeTable,
  SigningCosmWasmClient as LaunchpadSigningClient,
} from "@cosmjs/cosmwasm-launchpad";
import {
  codec,
  CosmWasmClient as StargateClient,
  SigningCosmWasmClient as StargateSigningClient,
} from "@cosmjs/cosmwasm-stargate";
import { Bip39, Random } from "@cosmjs/crypto";
import { GasLimits, makeCosmoshubPath, OfflineSigner, Secp256k1HdWallet } from "@cosmjs/launchpad";
import { LedgerSigner } from "@cosmjs/launchpad-ledger";
import { Registry } from "@cosmjs/proto-signing";
import TransportWebUSB from "@ledgerhq/hw-transport-webusb";

import { settings } from "../settings";
import { msgExecuteContractTypeUrl, msgInstantiateContractTypeUrl, msgStoreCodeTypeUrl } from "./txs";

export { LaunchpadClient, StargateClient, LaunchpadSigningClient, StargateSigningClient };

export function isStargateClient(client: LaunchpadClient | StargateClient | null): client is StargateClient {
  return client instanceof StargateClient;
}

export function isLaunchpadClient(
  client: LaunchpadClient | StargateClient | null,
): client is LaunchpadClient {
  return client instanceof LaunchpadClient;
}

export function isStargateSigningClient(
  signingClient: LaunchpadSigningClient | StargateSigningClient | null,
): signingClient is StargateSigningClient {
  return signingClient instanceof StargateSigningClient;
}

export function isLaunchpadSigningClient(
  signingClient: LaunchpadClient | StargateClient | null,
): signingClient is LaunchpadSigningClient {
  return signingClient instanceof LaunchpadSigningClient;
}

export function generateMnemonic(): string {
  return Bip39.encode(Random.getBytes(16)).toString();
}

export function loadOrCreateMnemonic(): string {
  const key = "burner-wallet";
  const loaded = localStorage.getItem(key);
  if (loaded) {
    return loaded;
  }
  const generated = generateMnemonic();
  localStorage.setItem(key, generated);
  return generated;
}

export type WalletLoader = (addressPrefix: string) => Promise<OfflineSigner>;

export async function loadOrCreateWallet(addressPrefix: string): Promise<OfflineSigner> {
  const mnemonic = loadOrCreateMnemonic();
  const hdPath = makeCosmoshubPath(0);
  const wallet = await Secp256k1HdWallet.fromMnemonic(mnemonic, hdPath, addressPrefix);
  return wallet;
}

export async function loadLedgerWallet(addressPrefix: string): Promise<OfflineSigner> {
  const interactiveTimeout = 120_000;
  const ledgerTransport = await TransportWebUSB.create(interactiveTimeout, interactiveTimeout);

  return new LedgerSigner(ledgerTransport, { hdPaths: [makeCosmoshubPath(0)], prefix: addressPrefix });
}

async function createLaunchpadSigningClient(signer: OfflineSigner): Promise<LaunchpadSigningClient> {
  const { nodeUrls, gasPrice } = settings.backend;
  const apiUrl = nodeUrls[0];

  const firstAddress = (await signer.getAccounts())[0].address;
  const gasLimits: GasLimits<CosmWasmFeeTable> = {
    upload: 1500000,
    init: 600000,
    exec: 400000,
    migrate: 600000,
    send: 80000,
    changeAdmin: 80000,
  };

  return new LaunchpadSigningClient(apiUrl, firstAddress, signer, gasPrice, gasLimits);
}

async function createStargateSigningClient(signer: OfflineSigner): Promise<StargateSigningClient> {
  const { nodeUrls, gasPrice } = settings.backend;
  const endpoint = nodeUrls[0];

  const { MsgStoreCode, MsgInstantiateContract, MsgExecuteContract } = codec.cosmwasm.wasm.v1beta1;
  const typeRegistry = new Registry([
    [msgStoreCodeTypeUrl, MsgStoreCode],
    [msgInstantiateContractTypeUrl, MsgInstantiateContract],
    [msgExecuteContractTypeUrl, MsgExecuteContract],
  ]);

  const gasLimits: GasLimits<CosmWasmFeeTable> = {
    upload: 1500000,
    init: 600000,
    exec: 400000,
    migrate: 600000,
    send: 80000,
    changeAdmin: 80000,
  };

  return StargateSigningClient.connectWithWallet(endpoint, signer, {
    registry: typeRegistry,
    gasPrice: gasPrice,
    gasLimits: gasLimits,
  });
}

export async function createSigningClient(
  signer: OfflineSigner,
): Promise<LaunchpadSigningClient | StargateSigningClient> {
  return settings.backend.stargateEnabled
    ? await createStargateSigningClient(signer)
    : await createLaunchpadSigningClient(signer);
}

export async function getAddressAndSigningClient(
  loadWallet: WalletLoader,
): Promise<[string, LaunchpadSigningClient | StargateSigningClient]> {
  const signer = await loadWallet(settings.backend.addressPrefix);
  const userAddress = (await signer.getAccounts())[0].address;
  const signingClient = await createSigningClient(signer);
  return [userAddress, signingClient];
}

export function disableLedgerLogin(): boolean {
  const anyNavigator: any = navigator;
  return !anyNavigator?.usb;
}
