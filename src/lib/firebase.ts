import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type {
  AssetId,
  JournalAssetData,
  MicroLiveResponse,
  RegisteredTradeOption,
  TradeGridRow,
  TradeOptionStatus,
} from '../types.ts';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export type PredictionRecord = JournalAssetData['predictions'][number];

export interface CloudPredictionItem {
  docId: string;
  asset: AssetId;
  record: PredictionRecord;
}

export interface CloudTradePreset {
  id: string;
  ownerId: string;
  asset: AssetId;
  dir: 'long' | 'short';
  slPct: number;
  tpPct: number;
  costPct: number;
  drift24hPct: number;
  evPct: number;
  evR: number;
  kellyPct: number;
  note?: string;
}

export interface CloudMicroBar {
  id: string;
  ownerId: string;
  asset: AssetId;
  inst: string;
  ts: number;
  mid: number;
  spreadBps: number;
  micropriceBps: number;
  imb5?: number | null;
  basisBps?: number | null;
  tkBuyBtc: number;
  tkSellBtc: number;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export async function syncUserProfile(user: User): Promise<void> {
  if (!user.email) return;
  const path = `users/${user.uid}/private/info`;
  const ref = doc(db, 'users', user.uid, 'private', 'info');
  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email: user.email,
        ...(user.displayName ? { displayName: user.displayName.slice(0, 120) } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        email: user.email,
        ...(user.displayName ? { displayName: user.displayName.slice(0, 120) } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function saveCloudPrediction(
  uid: string,
  asset: AssetId,
  rec: PredictionRecord,
): Promise<void> {
  const docId = sanitizeId(`${asset}_${rec.id}`);
  const path = `users/${uid}/predictions/${docId}`;
  const ref = doc(db, 'users', uid, 'predictions', docId);
  try {
    const existingSnap = await getDoc(ref);
    const payload = {
      ownerId: uid,
      asset,
      predId: sanitizeId(rec.id).slice(0, 32),
      anchorTs: rec.anchor_ts,
      spot: rec.spot,
      volAnnPct: rec.vol_ann_pct,
      volPctile: rec.vol_pctile,
      regimeVol: String(rec.regime_vol || 'Normal').slice(0, 32),
      biasAppliedPct: rec.bias_applied_pct ?? 0,
      flags: {
        fund: rec.flags?.fund ?? 'none',
        oi_flush: rec.flags?.oi_flush ?? null,
      },
      cone: rec.cone ?? {},
      coneEns: rec.cone_ens ?? {},
      ...(rec.cone_opt ? { coneOpt: rec.cone_opt } : {}),
      ensRatio: rec.ens_ratio ?? {},
      pUp: rec.p_up ?? {},
    };
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        anchorTs: payload.anchorTs,
        spot: payload.spot,
        volAnnPct: payload.volAnnPct,
        volPctile: payload.volPctile,
        regimeVol: payload.regimeVol,
        biasAppliedPct: payload.biasAppliedPct,
        flags: payload.flags,
        cone: payload.cone,
        coneEns: payload.coneEns,
        ...(rec.cone_opt ? { coneOpt: rec.cone_opt } : {}),
        ensRatio: payload.ensRatio,
        pUp: payload.pUp,
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeCloudPredictions(
  uid: string,
  onData: (items: CloudPredictionItem[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const path = `users/${uid}/predictions`;
  const q = query(collection(db, 'users', uid, 'predictions'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: CloudPredictionItem[] = snap.docs.map((d) => {
        const v = d.data();
        return {
          docId: d.id,
          asset: v.asset as AssetId,
          record: {
            id: String(v.predId),
            anchor_ts: Number(v.anchorTs),
            spot: Number(v.spot),
            vol_ann_pct: Number(v.volAnnPct),
            vol_pctile: Number(v.volPctile),
            regime_vol: String(v.regimeVol),
            gmm: { state: null, p: null },
            readings: {},
            gex: {},
            flags: (v.flags as { fund: string; oi_flush: boolean | null }) ?? {
              fund: 'none',
              oi_flush: null,
            },
            bias_applied_pct: Number(v.biasAppliedPct ?? 0),
            cone: (v.cone as Record<string, Record<string, number>>) ?? {},
            cone_ens: (v.coneEns as Record<string, Record<string, number>>) ?? {},
            cone_opt: (v.coneOpt as Record<string, Record<string, number>> | undefined) ?? null,
            ens_ratio: (v.ensRatio as Record<string, number>) ?? {},
            p_up: (v.pUp as Record<string, number>) ?? {},
          },
        };
      });
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    },
  );
}

export async function saveTradePreset(
  uid: string,
  params: {
    asset: AssetId;
    dir: 'long' | 'short';
    slPct: number;
    tpPct: number;
    costPct: number;
    drift24hPct: number;
    result: TradeGridRow;
    note?: string;
  },
): Promise<void> {
  const docId = sanitizeId(`preset_${params.asset}_${Date.now()}`);
  const path = `users/${uid}/tradePresets/${docId}`;
  const ref = doc(db, 'users', uid, 'tradePresets', docId);
  try {
    await setDoc(ref, {
      ownerId: uid,
      asset: params.asset,
      dir: params.dir,
      slPct: params.slPct,
      tpPct: params.tpPct,
      costPct: params.costPct,
      drift24hPct: params.drift24hPct,
      evPct: params.result.ev_pct,
      evR: params.result.ev_r,
      kellyPct: params.result.kelly_pct,
      ...(params.note ? { note: params.note.slice(0, 80) } : {}),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function deleteTradePreset(uid: string, presetId: string): Promise<void> {
  const docId = sanitizeId(presetId);
  const path = `users/${uid}/tradePresets/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'tradePresets', docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeTradePresets(
  uid: string,
  onData: (items: CloudTradePreset[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const path = `users/${uid}/tradePresets`;
  const q = query(collection(db, 'users', uid, 'tradePresets'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: CloudTradePreset[] = snap.docs.map((d) => {
        const v = d.data();
        return {
          id: d.id,
          ownerId: String(v.ownerId),
          asset: v.asset as AssetId,
          dir: v.dir === 'short' ? 'short' : 'long',
          slPct: Number(v.slPct),
          tpPct: Number(v.tpPct),
          costPct: Number(v.costPct),
          drift24hPct: Number(v.drift24hPct),
          evPct: Number(v.evPct),
          evR: Number(v.evR),
          kellyPct: Number(v.kellyPct),
          note: v.note ? String(v.note) : undefined,
        };
      });
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    },
  );
}

export async function saveMicroBarCloud(
  uid: string,
  asset: AssetId,
  inst: string,
  tick: MicroLiveResponse['tick'],
): Promise<void> {
  const docId = sanitizeId(`${asset}_${tick.ts}`);
  const path = `users/${uid}/microBars/${docId}`;
  const ref = doc(db, 'users', uid, 'microBars', docId);
  try {
    await setDoc(ref, {
      ownerId: uid,
      asset,
      inst: inst.slice(0, 32),
      ts: tick.ts,
      mid: tick.mid,
      spreadBps: tick.spread_bps,
      micropriceBps: tick.microprice_bps,
      ...(tick.imb5 !== null ? { imb5: tick.imb5 } : {}),
      ...(tick.basis_bps !== null ? { basisBps: tick.basis_bps } : {}),
      tkBuyBtc: tick.tk_buy_btc,
      tkSellBtc: tick.tk_sell_btc,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeMicroBars(
  uid: string,
  onData: (items: CloudMicroBar[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const path = `users/${uid}/microBars`;
  const q = query(collection(db, 'users', uid, 'microBars'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: CloudMicroBar[] = snap.docs
        .map((d) => {
          const v = d.data();
          return {
            id: d.id,
            ownerId: String(v.ownerId),
            asset: v.asset as AssetId,
            inst: String(v.inst),
            ts: Number(v.ts),
            mid: Number(v.mid),
            spreadBps: Number(v.spreadBps),
            micropriceBps: Number(v.micropriceBps),
            imb5: v.imb5 !== undefined ? Number(v.imb5) : null,
            basisBps: v.basisBps !== undefined ? Number(v.basisBps) : null,
            tkBuyBtc: Number(v.tkBuyBtc),
            tkSellBtc: Number(v.tkSellBtc),
          };
        })
        .sort((a, b) => b.ts - a.ts);
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    },
  );
}

export async function saveCloudTradeOption(
  uid: string,
  op: RegisteredTradeOption,
): Promise<void> {
  const docId = sanitizeId(op.id);
  const path = `users/${uid}/tradeOptions/${docId}`;
  const ref = doc(db, 'users', uid, 'tradeOptions', docId);
  try {
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        asset: op.asset,
        strategyKey: String(op.strategyKey || 'custom').slice(0, 32),
        title: String(op.title || 'Operación').slice(0, 80),
        dir: op.dir === 'short' ? 'short' : 'long',
        horizonHours: op.horizonHours === 72 ? 72 : 24,
        createdTs: op.createdTs,
        createdIso: String(op.createdIso).slice(0, 40),
        entryPrice: op.entryPrice,
        entryLow: op.entryLow,
        entryHigh: op.entryHigh,
        stopLoss: op.stopLoss,
        slPct: op.slPct,
        takeProfit1: op.takeProfit1,
        tp1Pct: op.tp1Pct,
        takeProfit2: op.takeProfit2,
        rr: op.rr,
        probTpPct: op.probTpPct,
        evPct: op.evPct,
        confluenceScore: op.confluenceScore,
        confidence: op.confidence,
        source: op.source === 'manual' ? 'manual' : 'auto',
        status: op.status,
        evaluatedTs: op.evaluatedTs ?? null,
        exitPrice: op.exitPrice ?? null,
        realizedPnlPct: op.realizedPnlPct ?? null,
        mfePct: op.mfePct ?? null,
        maePct: op.maePct ?? null,
        summary: String(op.summary || '').slice(0, 200),
        createdAt: serverTimestamp(),
      });
    } else {
      const prev = existingSnap.data();
      // Respect Terminal State Lock: only update outcome fields if currently open
      if (prev.status === 'open' && op.status !== 'open') {
        await updateDoc(ref, {
          status: op.status,
          evaluatedTs: op.evaluatedTs ?? Date.now(),
          exitPrice: op.exitPrice ?? op.entryPrice,
          realizedPnlPct: op.realizedPnlPct ?? 0,
          mfePct: op.mfePct ?? null,
          maePct: op.maePct ?? null,
        });
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteCloudTradeOption(uid: string, optionId: string): Promise<void> {
  const docId = sanitizeId(optionId);
  const path = `users/${uid}/tradeOptions/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'tradeOptions', docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export function subscribeCloudTradeOptions(
  uid: string,
  onData: (items: RegisteredTradeOption[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const path = `users/${uid}/tradeOptions`;
  const q = query(collection(db, 'users', uid, 'tradeOptions'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: RegisteredTradeOption[] = snap.docs
        .map((d) => {
          const v = d.data();
          return {
            id: d.id,
            asset: v.asset as AssetId,
            strategyKey: String(v.strategyKey ?? 'custom'),
            title: String(v.title ?? ''),
            dir: (v.dir === 'short' ? 'short' : 'long') as 'long' | 'short',
            horizonHours: (Number(v.horizonHours) === 72 ? 72 : 24) as 24 | 72,
            createdTs: Number(v.createdTs),
            createdIso: String(v.createdIso ?? ''),
            entryPrice: Number(v.entryPrice),
            entryLow: Number(v.entryLow),
            entryHigh: Number(v.entryHigh),
            stopLoss: Number(v.stopLoss),
            slPct: Number(v.slPct),
            takeProfit1: Number(v.takeProfit1),
            tp1Pct: Number(v.tp1Pct),
            takeProfit2: Number(v.takeProfit2),
            rr: Number(v.rr),
            probTpPct: Number(v.probTpPct),
            evPct: Number(v.evPct),
            confluenceScore: Number(v.confluenceScore),
            confidence: (v.confidence ?? 'Media') as RegisteredTradeOption['confidence'],
            source: (v.source === 'manual' ? 'manual' : 'auto') as 'auto' | 'manual',
            status: (v.status ?? 'open') as TradeOptionStatus,
            evaluatedTs: v.evaluatedTs !== undefined && v.evaluatedTs !== null ? Number(v.evaluatedTs) : null,
            exitPrice: v.exitPrice !== undefined && v.exitPrice !== null ? Number(v.exitPrice) : null,
            realizedPnlPct:
              v.realizedPnlPct !== undefined && v.realizedPnlPct !== null ? Number(v.realizedPnlPct) : null,
            mfePct: v.mfePct !== undefined && v.mfePct !== null ? Number(v.mfePct) : null,
            maePct: v.maePct !== undefined && v.maePct !== null ? Number(v.maePct) : null,
            summary: String(v.summary ?? ''),
          };
        })
        .sort((a, b) => b.createdTs - a.createdTs);
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, path);
    },
  );
}

