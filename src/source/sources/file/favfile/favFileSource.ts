import { Uri, workspace } from 'coc.nvim';
import fs from 'fs';
import { homedir } from 'os';
import pathLib from 'path';
import { argOptions } from '../../../../argOptions';
import { onBufEnter } from '../../../../events';
import { fileList } from '../../../../lists/files';
import { onError } from '../../../../logger';
import {
  fsAccess,
  fsLstat,
  fsReaddir,
  fsStat,
  getExtensions,
  isWindows,
  listDrive,
  normalizePath,
  Notifier,
} from '../../../../util';
import { hlGroupManager } from '../../../highlightManager';
import { BaseTreeNode, ExplorerSource } from '../../../source';
import { sourceManager } from '../../../sourceManager';
import { SourcePainters } from '../../../sourcePainters';
import { initFileActions } from '../fileActions';
import { fileColumnRegistrar } from '../fileColumnRegistrar';
import '../load';
import { FileNode, FileSource, RenderPathsOptions } from '../fileSource';

export class FavFileSource extends FileSource {
  scheme = 'favfile';
  hlSrcId = workspace.createNameSpace('coc-explorer-favfile');
  rootNode: FileNode = {
    type: 'root',
    isRoot: true,
    uid: super.helper.getUid('0'),
    name: 'favorite',
    fullpath: homedir(),
    expandable: true,
    directory: true,
    readonly: true,
    executable: false,
    readable: true,
    writable: false,
    hidden: false,
    symbolicLink: true,
    lstat: undefined,
  };
  sourcePainters: SourcePainters<FileNode> = new SourcePainters<FileNode>(
    this,
    fileColumnRegistrar,
  );

  get root() {
    return this.rootNode.fullpath;
  }

  set root(root: string) {
      // do not need set root
  }

  async init() {
    const { nvim } = this;

    if (this.config.get('activeMode')) {
      if (workspace.isNvim) {
        if (this.config.get('file.autoReveal')) {
          this.disposables.push(
            onBufEnter(async (bufnr) => {
              if (bufnr === this.explorer.bufnr) {
                return;
              }
              const position = await this.explorer.args.value(
                argOptions.position,
              );
              if (position === 'floating') {
                return;
              }
              const fullpath = this.bufManager.getBufferNode(bufnr)?.fullpath;
              if (!fullpath) {
                return;
              }
              const [
                revealNode,
                notifiers,
              ] = await this.revealNodeByPathNotifier(fullpath);
              if (revealNode) {
                await Notifier.runAll(notifiers);
              }
            }, 200),
          );
        }
      } else {
        this.disposables.push(
          onBufEnter(async (bufnr) => {
            if (bufnr === this.explorer.bufnr) {
              await this.load(this.rootNode);
            }
          }, 200),
        );
      }
    }

    this.disposables.push(
      this.events.on('loaded', () => {
        this.copiedNodes.clear();
        this.cutNodes.clear();
      }),
    );

    initFileActions(this);
  }

  async loadChildren(parentNode: FileNode): Promise<FileNode[]> {
    let filenames: string[];
    if (isWindows && parentNode.fullpath === '') {
      filenames = await listDrive();
    } else {
      filenames = await fsReaddir(parentNode.fullpath);
    }
    const files = await Promise.all(
      filenames.map(async (filename) => {
        try {
          const hidden = this.isHidden(filename);
          if (!this.showHidden && hidden) {
            return;
          }
          const fullpath = normalizePath(
            pathLib.join(parentNode.fullpath, filename),
          );
          const stat = await fsStat(fullpath).catch(() => {});
          const lstat = await fsLstat(fullpath).catch(() => {});
          const executable = await fsAccess(fullpath, fs.constants.X_OK);
          const writable = await fsAccess(fullpath, fs.constants.W_OK);
          const readable = await fsAccess(fullpath, fs.constants.R_OK);
          const directory =
            isWindows && /^[A-Za-z]:[\\\/]$/.test(fullpath)
              ? true
              : stat
              ? stat.isDirectory()
              : false;
          const child: FileNode = {
            type: 'child',
            uid: this.helper.getUid(fullpath),
            expandable: directory,
            name: filename,
            fullpath,
            directory: directory,
            readonly: !writable && readable,
            executable,
            readable,
            writable,
            hidden,
            symbolicLink: lstat ? lstat.isSymbolicLink() : false,
            lstat: lstat || undefined,
          };
          return child;
        } catch (error) {
          onError(error);
          return;
        }
      }),
    );

    return this.sortFiles(files.filter((r): r is FileNode => !!r));
  }
}

sourceManager.registerSource('favfile', FavFileSource);
