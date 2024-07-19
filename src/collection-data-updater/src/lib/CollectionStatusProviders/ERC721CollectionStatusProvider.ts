import { BigNumber, BigNumberish, Contract, ethers } from "ethers";
import CollectionStatusProviderInterface from "../CollectionStatusProviderInterface";
import EventDataInterface from "../EventDataInterface";
import { isFullUpdate } from "../../CollectionDataUpdater";
import { isNewMint } from "../Runtimes/UpdateTokenOnMintRuntime";
import { config } from "../../../../config";

export const EVENT_DATA_IS_REVEALED = "__isRevealed";

export const isRevealed = (
  eventData: EventDataInterface
): boolean | undefined => {
  return eventData[EVENT_DATA_IS_REVEALED];
};

export const EVENT_DATA_FORCED_COLLECTION_STATUS_REFRESH =
  "__forcedCollectionStatusRefresh";

export const forcedCollectionStatusRefresh = (
  eventData: EventDataInterface
): boolean | undefined => {
  return eventData[EVENT_DATA_FORCED_COLLECTION_STATUS_REFRESH];
};

export default class ERC721CollectionStatusProvider
  implements CollectionStatusProviderInterface
{
  private fromAddress: string = ethers.utils.getAddress("0x0000000000000000000000000000000000000000");
  private totalSupply: BigNumber = BigNumber.from(0);
  private tokenIds: BigNumber[] = [];
  private readonly startTokenId: BigNumber;

  public constructor(
    private contract: Contract,
    startTokenId: BigNumber | number = 1
  ) {
    this.startTokenId = BigNumber.from(startTokenId);
  }

  public async getTokenIds(): Promise<BigNumber[]> {
    if (this.tokenIds.length === 0) {
      const maxSupply = await this.contract.maxSupply();

      for (let i = this.startTokenId; i.lte(maxSupply); i = i.add(1)) {
        this.tokenIds.push(i);
      }
    }

    return this.tokenIds;
  }

  public async processEventDataBeforeUpdate(
    eventData: EventDataInterface
  ): Promise<EventDataInterface> {
    if (isNewMint(eventData) === true) {
      if (eventData.tokenId.gt(this.totalSupply)) {
        this.totalSupply = eventData.tokenId;
      }

      return { [EVENT_DATA_IS_REVEALED]: true, ...eventData };
    }

    if (
      forcedCollectionStatusRefresh(eventData) === true ||
      (isFullUpdate(eventData) === true &&
        eventData.tokenId.eq(this.startTokenId))
    ) {
      const lastMintedTokenId = await this.getLastMintedTokenID();
      console.log(`Last minted token ID is ${lastMintedTokenId}`);
      const totalSupplyContract = await this.contract.totalSupply();
      console.log(`Total supply from contract is ${totalSupplyContract}`);
      if (lastMintedTokenId.gt(totalSupplyContract)) {
        this.totalSupply = lastMintedTokenId;
      } else {
        this.totalSupply = totalSupplyContract;
      }
      console.log(`Minted tokens: ${this.totalSupply}`);
    }

    return {
      [EVENT_DATA_IS_REVEALED]: eventData.tokenId.lte(this.totalSupply),
      ...eventData,
    };
  }

  private async getLastMintedTokenID(): Promise<BigNumber> {
    const creatorTxnBlockNumber = Number(config.CREATOR_TXN_BLOCK_NUMBER);
    let latestBlock = await this.contract.provider.getBlockNumber();
    const latestMints: ethers.Event[] = [];
    while (latestBlock >= creatorTxnBlockNumber) {
      const mintEvents = await this.contract.queryFilter(
        this.contract.filters.Transfer(
          this.fromAddress,
          null
        ),
        latestBlock - 3000,
        latestBlock
      );
      // if (mintEvents.length > 0) {
      latestMints.push(...mintEvents);
      // }
      latestBlock -= 3000;
    }
    const tokenIds = latestMints.map((m) =>
      Number((m!.args!.tokenId as BigNumberish).toString())
    );
    const lastMintedTokenId = Math.max(...tokenIds);
    return BigNumber.from(lastMintedTokenId);
  }
}
