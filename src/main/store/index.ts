import Store from 'electron-store';

import { StoreType } from '../types/Store';

import { schema } from './schema';
import { defaults } from './defaults';
import migrations, { upgradeSettings } from './migrations';

import { version } from '../../../package.json';

export const store = new Store<StoreType>({
  schema,
  defaults,
  migrations,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore: Electron Store supports projectVersion but it's not typed
  projectVersion: version,
});

upgradeSettings(store);

export { defaults };
