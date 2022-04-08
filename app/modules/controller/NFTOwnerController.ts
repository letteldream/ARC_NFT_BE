import { IQueryFilters } from "../interfaces/Query";
import { IUser } from "../interfaces/IUser";
import { respond } from "../util/respond";
import { IResponse } from "../interfaces/IResponse";
import { AbstractEntity } from "../abstract/AbstractEntity";
import { IPerson } from "../interfaces/IPerson";
import { INFT } from "../interfaces/INFT";
import { IActivity } from "../interfaces/IActivity";
import { INFTCollection } from "../interfaces/INFTCollection";
import { S3GetSignedUrl, S3uploadImageBase64 } from "../util/aws-s3-helper";
import { ObjectId } from "mongodb";
export class NFTOwnerController extends AbstractEntity {
  protected data: IPerson;
  protected table = "Person" as string;
  protected nftTable = "NFT" as string;
  protected historyTable = "Activity" as string;
  protected collectionTable = "NFTCollection" as string;
  constructor(user?: IPerson) {
    super();
    this.data = user;
  }
  /**
   * Gets a set of rows from the database
   * @param {IQueryFilters} filters
   */
  async findAllOwners(filters?: IQueryFilters): Promise<Array<IPerson> | IResponse> {
    try {
      if (this.mongodb) {
        const owner = this.mongodb.collection(this.table);
        const nftTable = this.mongodb.collection(this.nftTable);
        const collection = this.mongodb.collection(this.collectionTable);
        let aggregation = {} as any;
        if (filters) {
          aggregation = this.parseFilters(filters);
        }
        const result = (await owner.aggregate(aggregation).toArray()) as Array<IPerson>;
        let photo = "";
        if (result) {
          const items = await Promise.all(
            result.map(async (item) => {
              const ntfs = await nftTable.find({ owner: item.wallet }).count();
              const colls = await collection.find({ creator: item.wallet }).count();
              // if (item.photoUrl){
              //   photo=await S3GetSignedUrl(item.photoUrl);
              // }
              return {
                _id: item._id,
                photoUrl: item.photoUrl,
                wallet: item.wallet,
                username: item.username,
                bio: item.bio,
                social: item.social,
                nfts: ntfs,
                collections: colls,
              };
            })
          );

          return respond(items);
        }
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  /**
   * Finds the user which has the given wallet id.
   *
   * @param walletId eth user's main wallet id
   * @returns `IPerson`
   */
  async findPerson(personId: string): Promise<IPerson | IResponse> {
    const query = this.findUserQuery(personId);
    const personTable = this.mongodb.collection(this.table);
    // const result = await this.findOne(query);
    const result = await personTable.findOne(query);
    const nftTable = this.mongodb.collection(this.nftTable);
    const collection = this.mongodb.collection(this.collectionTable);
    const ntfs = await nftTable.find({ owner: personId }).count();
    const colls = await collection.find({ creator: personId }).count();

    if (result) {
      return respond({
        id: result._id,
        photoUrl: result.photoUrl,
        wallet: result.wallet,
        username: result.username,
        bio: result.bio,
        social: result.social,
        nfts: ntfs,
        collections: colls,
      });
    } else {
      await personTable.insertOne({
        wallet: personId,
        photoUrl: "",
        social: "",
        bio: "",
        username: "",
      });

      const result = await personTable.findOne(query);
      return respond({
        id: result._id,
        photoUrl: result.photoUrl,
        wallet: result.wallet,
        username: result.username,
        bio: result.bio,
        social: result.social,
        nfts: 0,
        collections: 0,
      });
    }
  }
  /**
   *
   * @param backgroundUrl
   * @param photoUrl
   * @param wallet
   * @param joinedDate
   * @param displayName
   * @param username
   * @returns new owner created
   */
  async createOwner(
    photoUrl: string,
    wallet: string,
    bio: string,
    username: string,
    social: string
  ): Promise<IPerson | IResponse> {
    const collection = this.mongodb.collection(this.table);
    const findOwner = (await collection.findOne(this.findUserQuery(wallet))) as IPerson;
    if (findOwner && findOwner._id) {
      return respond("Current user has been created", true, 501);
    }

    const person: IPerson = {
      photoUrl,
      wallet:wallet,
      social,
      bio,
      username: username,
      // nfts: [],
      // collections: []
      // created: [],
      // favourites: [],
      // history: [],
    };

    const result = await collection.insertOne(person);
    return result
      ? respond(`Successfully created a new owner with id ${result.insertedId}`, false, 201)
      : respond("Failed to create a new owner.", true, 501);
  }
  /**
   *
   * @param personId @param
   * @param bodyData IPerson
   * @returns
   */
  async updateOwner(wallet: string, bodyData: any): Promise<IPerson | IResponse> {
    try {
      if (this.mongodb) {
        const collection = this.mongodb.collection(this.table);
        const result = await collection.updateOne({ wallet }, { $set: { ...bodyData } });
        return respond(result);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }

  async updateOwnerPhoto(wallet: string, body: any): Promise<IPerson | IResponse> {
    try {
      if (this.mongodb) {
        const person = this.mongodb.collection(this.table);
        const findOwner = (await person.findOne(this.findUserQuery(wallet))) as IPerson;
        if (!findOwner) {
          return respond("Current user not exists", true, 422);
        }
        const img = await S3uploadImageBase64(body, wallet);
        const result = await person.updateOne({ wallet }, { $set: { photoUrl: img } });
        if (result) {
          return this.findPerson(wallet);
        }

        return respond("owner not found.", true, 422);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }

  /**
   *
   * @param ownerId  eq WalletId
   * @param filters IQueryFilters
   *  OrderBy , direction, filters :[{fieldName:@field,query:@value}]
   *
   * @returns INFT
   */
  async getOwnerNtfs(ownerId: string, filters?: IQueryFilters): Promise<Array<INFT> | IResponse> {
    try {
      if (this.mongodb) {
        const collection = this.mongodb.collection(this.nftTable);
        let aggregation = [] as any;
        const query = this.findOwnerNtfs(ownerId);

        if (filters) {
          aggregation = this.parseFilters(filters);
          aggregation.push({ $match: { ...query } });
        } else {
          aggregation.push({ $match: { ...query } });
        }
        const result = (await collection.aggregate(aggregation).toArray()) as Array<INFT>;
        if (result) {
          return respond(result);
        }
        return respond("Items not found.", true, 422);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  /**
   *
   * @param ownerId eq walletId
   * @param filters IQueryFilters
   * @returns IHistory
   */
  async getOwnerHistory(ownerId: string, filters?: IQueryFilters): Promise<Array<IActivity> | IResponse> {
    try {
      if (this.mongodb) {
        const activity = this.mongodb.collection(this.historyTable);
        const nftTable = this.mongodb.collection(this.nftTable);
        const collection = this.mongodb.collection(this.collectionTable);
        let aggregation = [] as any;
        const query = this.findOwnerHistory(ownerId);
        if (filters) {
          aggregation = this.parseFilters(filters);
          aggregation.push({ $match: { ...query } });
        } else {
          aggregation.push({ $match: { ...query } });
        }

        const result = (await activity.aggregate(aggregation).toArray()) as Array<IActivity>;
        if (result) {
          const resActivities = await Promise.all(
            result.map(async (item) => {
              const nfts = (await nftTable.findOne({ collection: item.collection, index: item.nftId })) as INFT;
              const coll = (await collection.findOne({ _id: new ObjectId(item.collection) })) as INFTCollection;

              return {
                ...item,
                nft: { artUri: nfts.artURI, name: nfts.name },
                collection: { ...coll },
              };
            })
          );

          return respond(resActivities);
        }

        return respond("Activities not found.", true, 422);

        //   const items = await collection.aggregate(aggregation).toArray();
        //   return items as Array<IActivity>;
        // } else {
        //   const result = await collection.find(query).toArray();
        //   return result as Array<IActivity>
        // }
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  /**
   *
   * @param ownerId eq walletId
   * @param filters
   * @returns INFTCollection
   */
  async getOwnerCollection(ownerId: string, filters?: IQueryFilters): Promise<Array<INFTCollection> | IResponse> {
    try {
      if (this.mongodb) {
        const collection = this.mongodb.collection(this.collectionTable);
        const nftTable = this.mongodb.collection(this.nftTable);
        const person = this.mongodb.collection(this.table);
        const activityTable = this.mongodb.collection(this.historyTable);
        let aggregation = [] as any;

        const query = this.findOwnerCollection(ownerId);
        if (filters) {
          aggregation = this.parseFilters(filters);
          aggregation.push({ $match: { ...query } });
        } else {
          aggregation.push({ $match: { ...query } });
        }

        const result = (await collection.aggregate(aggregation).toArray()) as Array<INFTCollection>;
        if (result) {
          const collections = await Promise.all(
            result.map(async (collection) => {
              let volume = 0;
              let _24h = 0;
              let floorPrice = Number.MAX_VALUE;
              let owners = [];
              const nfts = (await nftTable.find({ collection: collection._id }).toArray()) as Array<INFT>;
              const personInfo = (await person.findOne({ wallet: collection.creator })) as IPerson;
              nfts.forEach((nft) => {
                volume += nft.price;
                if (floorPrice > nft.price) floorPrice = nft.price;
                if (owners.indexOf(nft.owner) == -1) owners.push(nft.owner);
              });

              const soldList = (await activityTable.find({ collection: collection._id }).toArray()) as Array<IActivity>;

              let yesterDayTrade = 0;
              let todayTrade = 0;
              const todayDate = new Date();
              const yesterdayDate = new Date(todayDate.getTime());
              yesterdayDate.setDate(yesterdayDate.getDate() - 1);
              const dayBeforeDate = new Date(todayDate.getTime());
              dayBeforeDate.setDate(dayBeforeDate.getDate() - 2);

              soldList.forEach((sold) => {
                if (sold.date > yesterdayDate.getTime() / 1000) todayTrade += sold.price;
                else if (sold.date > dayBeforeDate.getTime() / 1000) yesterDayTrade += sold.price;
              });

              if (todayTrade == 0) _24h = 0;
              else if (yesterDayTrade == 0) _24h = 100;
              else _24h = (todayTrade / yesterDayTrade) * 100;

              return {
                ...collection,
                volume: volume,
                _24h: _24h,
                floorPrice: floorPrice,
                owners: owners.length,
                items: nfts.length,
                creatorDetail: { ...personInfo },
              };
            })
          );

          return respond(collections);
        }
        return respond("collection not found.", true, 422);
        // if (filters.filters.length > 0) {
        //   aggregation = this.parseFilters(filters);
        //   aggregation.push({ $match: { ...query }, });
        //   const items = await collection.aggregate(aggregation).toArray();
        //   return items as Array<INFTCollection>;
        // } else {
        //   const result = await collection.find(query).toArray();
        //   return result as Array<INFTCollection>
        // }
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }

  /**
   *
   * @param ownerId
   *
   * @param contract
   * @param nftId
   * @returns
   */

  async getOwnerOffers(ownerId: string, filters?: IQueryFilters): Promise<Array<IActivity> | IResponse> {
    try {
      if (this.mongodb) {
        const activity = this.mongodb.collection(this.historyTable);
        const nftTable = this.mongodb.collection(this.nftTable);
        const collection = this.mongodb.collection(this.collectionTable);

        let aggregation = [] as any;
        if (filters) {
          aggregation = this.parseFilters(filters);
        }
        aggregation.push({
          $match: {
            $or: [{ from: { $regex: new RegExp(ownerId, "igm") } }, { to: { $regex: new RegExp(ownerId, "igm") } }],
            type: "Offer",
          },
        });
        const result = await activity.aggregate(aggregation).toArray();
        if (result) {
          const resActivities = await Promise.all(
            result.map(async (item) => {
              const nfts = (await nftTable.findOne({ collection: item.collection, index: item.nftId })) as INFT;
              item.nft = { artUri: nfts.artURI, name: nfts.name };
              return item;
            })
          );

          return respond(resActivities);
        }

        return respond("Activities not found.", true, 422);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }

  /**
   *
   * @param ownerId
   * @param contract
   * @param nftId
   * @returns
   */
  async insertFavourite(ownerId: string, collectionId: string, nftId: string) {
    const collTable = this.mongodb.collection(this.collectionTable);
    const nft = this.mongodb.collection(this.nftTable);
    const ownerTable = this.mongodb.collection(this.table);
    const collection = await collTable.findOne(this.findCollectionItem(collectionId));
    if (!collection) {
      return respond("collection not found", true, 501);
    }
    const queryNft = this.findNFTItem(collectionId, nftId);
    const nftResult = (await nft.findOne(queryNft)) as INFT;
    if (!nftResult) {
      return respond("Nft not found", true, 501);
    }
    const owner = (await ownerTable.findOne(this.findUserQuery(ownerId))) as IPerson;
    if (!owner) {
      return respond("to onwer not found.", true, 422);
    }
    // const index = owner.favourites.indexOf(nftResult,0);
    // const index = await owner.favourites.findIndex(o => o.index === nftResult.index);
    // if (index>=0){
    return respond("This NFT already favourite");
    // }else{
    //   owner.favourites.push(nftResult);
    //   ownerTable.replaceOne({wallet:owner.wallet},owner);
    //   await nft.updateOne({_id:nftResult._id},{$inc:{like:1}});
    //   return respond("Favourite updated");
    // }
  }
  /**
   *
   * @param ownerId
   * @param contract
   * @param nftId
   * @returns
   */
  async removeFavourite(ownerId: string, collectionId: string, nftId: string) {
    const collTable = this.mongodb.collection(this.collectionTable);
    const nft = this.mongodb.collection(this.nftTable);
    const ownerTable = this.mongodb.collection(this.table);
    const collection = await collTable.findOne(this.findCollectionItem(collectionId));
    if (!collection) {
      return respond("collection not found", true, 501);
    }
    const queryNft = this.findNFTItem(collectionId, nftId);
    const nftResult = (await nft.findOne(queryNft)) as INFT;
    if (!nftResult) {
      return respond("Nft not found", true, 501);
    }
    const owner = (await ownerTable.findOne(this.findUserQuery(ownerId))) as IPerson;
    if (!owner) {
      return respond("to onwer not found.", true, 422);
    }
    // const index = await owner.favourites.findIndex(o => o.index === nftResult.index);
    // if (index>=0){
    //   owner.favourites.splice(index,1);
    //   ownerTable.replaceOne({wallet:owner.wallet},owner);
    //   await nft.updateOne({_id:nftResult._id},{$inc:{like:-1}});
    return respond("Favourite removed");
    // }else{
    //   return respond("Nothing removed ");
    // }
  }
  /**
   * Mounts a generic query to find an user by its ownerId.
   * @param ownerId =walletId
   * @returns
   */
  private findUserQuery(ownerId: String): Object {
    return { wallet: ownerId };
  }
  private findOwnerNtfs(ownerId: String): Object {
    return { owner: ownerId };
  }
  private findOwnerHistory(ownerId: String): Object {
    return {
      $or: [{ from: ownerId }, { to: ownerId }],
    };
  }
  private findOwnerCollection(ownerId: String): Object {
    return { creator: ownerId };
  }
  /**
   * Mounts a generic query to find a collection by contract address.
   * @param collectionId
   * @returns
   */
  private findCollectionItem(collectionId: string): Object {
    return {
      _id: new ObjectId(collectionId),
    };
  }
  /**
   * Mounts a generic query to find an item by its collection contract and index.
   * @param collectionId
   * @returns
   */
  private findNFTItem(collectionId: string, nftId: string): Object {
    return {
      collection: collectionId,
      index: nftId,
    };
  }
}
