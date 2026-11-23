import React, { useEffect, useMemo, useRef, useState } from 'react';
import classnames from 'classnames/bind';

import { Icon } from 'renderer/components';
import { useSettings } from 'renderer/contexts/Settings';
import { getAllSongs, sourceName } from 'renderer/helpers';
import { ImportedSong } from 'main/types';

import { SpotifySongLink } from '../Settings/RhythmGameSettings/SpotifySettings';
import styles from './SongLibrary.module.scss';

const cx = classnames.bind(styles);

/** "Creep by Radiohead": the name and the artist */
export const splitTitle = (title: string) => {
  const [name, ...artist] = title.split(/\s+by\s+/i);
  return { name, artist: artist.join(' by ') };
};

/** A song's cover: its album's (linked to Spotify or YouTube), else its first letter */
export const SongCover: React.FC<{ song?: ImportedSong; title: string; small?: boolean }> = ({
  song,
  title,
  small = false,
}) => {
  const image = song?.spotify?.imageUrl;
  if (image) {
    return <img className={cx('cover', { 'cover--small': small })} src={image} alt="" />;
  }
  // (a color of its own, from its name)
  const hue = [...title].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return (
    <span
      className={cx('cover', 'cover--letter', { 'cover--small': small })}
      style={{ '--hue': hue } as React.CSSProperties}
      aria-hidden
    >
      {splitTitle(title).name.trim().charAt(0).toUpperCase() || '♪'}
    </span>
  );
};

SongCover.defaultProps = { song: undefined, small: false };

/** What a song has: its key, tempo, parts, and where it plays */
export const songDetails = (song?: ImportedSong) => {
  if (!song) return ['Built-in'];
  return [
    song.key && `Key of ${song.key}`,
    song.bpm && `${song.bpm} BPM`,
    song.parts?.length && `${song.parts.length} parts`,
    song.spotify &&
      `${sourceName(song.spotify.uri)}${song.spotify.firstChordMs !== undefined ? ' synced' : ''}`,
  ].filter(Boolean) as string[];
};

type Props = {
  songs: ImportedSong[];
  /** the song chosen ('' : random songs) */
  chosen: string;
  onPick: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
};

/**
 * The songs to play, with their covers: searched by name, picked with a click, an imported one
 * edited (its tempo, its Spotify or YouTube link) or removed (a second click on its bin
 * confirms)
 */
const SongLibrary: React.FC<Props> = ({ songs, chosen, onPick, onRemove, onClose }) => {
  const [search, setSearch] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  // the song being edited (its tempo, its link)
  const [editing, setEditing] = useState<string | null>(null);
  const { settings, updateSetting } = useSettings();
  const linksOn = !!settings.rhythmGame.spotifySync;
  /** Changes a song (the others as they are) */
  const change = (id: string, changed: (song: ImportedSong) => ImportedSong) =>
    updateSetting(
      'rhythmGame.customSongs',
      songs.map((song) => (song.id === id ? changed(song) : song))
    );
  // its tempo typed in (empty: no tempo of its own)
  const setTempo = (id: string, value: string) => {
    const bpm = Math.round(Number(value));
    change(id, ({ bpm: _old, ...rest }) => (value && bpm > 0 ? { ...rest, bpm } : rest));
  };
  const setLink = (id: string, link: ImportedSong['spotify']) =>
    change(id, ({ spotify: _old, ...rest }) => (link ? { ...rest, spotify: link } : rest));
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => searchInput.current?.focus(), []);

  // Esc closes it
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // your songs first (the newest first), then the built-in ones
  const all = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return getAllSongs(songs)
      .filter((song) => words.every((word) => song.title.toLowerCase().includes(word)))
      .sort((a, b) => Number(!!b.imported) - Number(!!a.imported));
  }, [songs, search]);
  const yours = all.filter((song) => song.imported).reverse();
  const builtIn = all.filter((song) => !song.imported);

  const card = (id: string, title: string, imported?: ImportedSong) => {
    const { name, artist } = splitTitle(title);
    return (
      <li
        key={id}
        className={cx('card', {
          'card--chosen': chosen === id,
          'card--editing': editing === id,
        })}
      >
        <button type="button" className={cx('pick')} onClick={() => onPick(id)} title={title}>
          <SongCover song={imported} title={title} />
          <span className={cx('text')}>
            <strong className={cx('name')}>{name}</strong>
            {artist && <span className={cx('artist')}>{artist}</span>}
            <span className={cx('details')}>{songDetails(imported).join(' · ')}</span>
          </span>
        </button>
        {imported && (
          <button
            type="button"
            className={cx('edit', { 'edit--on': editing === id })}
            onClick={() => setEditing((current) => (current === id ? null : id))}
            title="Its tempo and its Spotify or YouTube link"
            aria-label={`Edit ${title}`}
            aria-expanded={editing === id}
          >
            <Icon name="settings" />
          </button>
        )}
        {imported && (
          <button
            type="button"
            className={cx('remove', { 'remove--confirm': removing === id })}
            onClick={() => {
              if (removing === id) {
                onRemove(id);
                setRemoving(null);
              } else setRemoving(id);
            }}
            onBlur={() => setRemoving((current) => (current === id ? null : current))}
            title={removing === id ? 'Click again to remove it' : 'Remove'}
            aria-label={removing === id ? `Remove ${title}: click again` : `Remove ${title}`}
          >
            {removing === id ? 'Remove?' : <Icon name="trash" />}
          </button>
        )}
        {imported && editing === id && (
          <div className={cx('editor')}>
            <span className={cx('tempo')}>
              Tempo
              <input
                type="number"
                min={1}
                placeholder="BPM?"
                aria-label={`Tempo of ${title}`}
                value={imported.bpm ?? ''}
                onChange={(e) => setTempo(id, e.target.value)}
              />
              BPM
            </span>
            {linksOn && <SpotifySongLink song={imported} onChange={(link) => setLink(id, link)} />}
          </div>
        )}
      </li>
    );
  };

  return (
    <div
      className={cx('backdrop')}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={cx('base')} role="dialog" aria-label="Your songs">
        <div className={cx('header')}>
          <input
            ref={searchInput}
            className={cx('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your songs"
            aria-label="Search your songs"
          />
          <button type="button" className={cx('close')} onClick={onClose} title="Close (Esc)">
            <Icon name="cross" />
          </button>
        </div>
        <div className={cx('scroll')}>
          {!search && (
            <ul className={cx('grid')}>
              <li className={cx('card', { 'card--chosen': !chosen })}>
                <button type="button" className={cx('pick')} onClick={() => onPick('')}>
                  <span className={cx('cover', 'cover--random')} aria-hidden>
                    ?
                  </span>
                  <span className={cx('text')}>
                    <strong className={cx('name')}>Random song</strong>
                    <span className={cx('details')}>A new one each time</span>
                  </span>
                </button>
              </li>
            </ul>
          )}
          {yours.length > 0 && (
            <>
              <h3 className={cx('title')}>Your songs</h3>
              <ul className={cx('grid')}>
                {yours.map((song) => card(song.id, song.title, song.imported))}
              </ul>
            </>
          )}
          {builtIn.length > 0 && (
            <>
              <h3 className={cx('title')}>Built-in</h3>
              <ul className={cx('grid')}>{builtIn.map((song) => card(song.id, song.title))}</ul>
            </>
          )}
          {!all.length && <p className={cx('empty')}>No song is called that</p>}
        </div>
      </div>
    </div>
  );
};

export default SongLibrary;
