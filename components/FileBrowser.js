'use strict';

/**
 * Browse a build-generated JSON tree and link files as same-origin static URLs.
 * Used by `/downloads` (`assets/downloads/index.json`).
 */

const React = require('react');
const { Link, Navigate, useLocation } = require('react-router-dom');
const {
  Breadcrumb,
  Header,
  Icon,
  Loader,
  Message,
  Segment,
  Table
} = require('semantic-ui-react');
const {
  breadcrumbsForPath,
  entriesForPath,
  filesFromIndex,
  formatByteSize,
  hrefForRootRelative,
  relativePathFromLocation
} = require('../functions/hubDownloadsTree');

function FileBrowser (props) {
  const rootPath = (props && props.rootPath) ? String(props.rootPath) : '/downloads';
  const indexUrl = (props && props.indexUrl) ? String(props.indexUrl) : '/downloads/index.json';
  const title = (props && props.title) ? String(props.title) : 'Downloads';
  const description = (props && props.description) ? String(props.description) : '';
  const indexFromProps = props && props.index ? props.index : null;
  const location = useLocation();
  const located = relativePathFromLocation(location && location.pathname, rootPath);

  const [index, setIndex] = React.useState(() => indexFromProps);
  const [status, setStatus] = React.useState(() => (indexFromProps ? 'ready' : 'loading'));
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (indexFromProps) return undefined;
    let cancelled = false;
    setStatus('loading');
    setError(null);
    const run = typeof fetch === 'function'
      ? fetch(indexUrl, { headers: { Accept: 'application/json' } })
      : Promise.reject(new Error('fetch unavailable'));
    run
      .then((res) => {
        if (!res || !res.ok) {
          const code = res && res.status ? res.status : 0;
          throw new Error(`Could not load ${indexUrl} (${code || 'network'})`);
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setIndex(data);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err && err.message ? err.message : 'Could not load downloads index');
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [indexUrl, indexFromProps]);

  if (located.invalid) {
    return <Navigate to={rootPath} replace />;
  }

  const files = filesFromIndex(index);
  const currentPath = located.path;
  const crumbs = breadcrumbsForPath(currentPath);
  const entries = entriesForPath(files, currentPath);
  const exactFile = files.find((f) => f.path === currentPath) || null;
  const parentPath = currentPath.indexOf('/') >= 0
    ? currentPath.slice(0, currentPath.lastIndexOf('/'))
    : '';
  const parentHref = currentPath
    ? hrefForRootRelative(rootPath, parentPath)
    : null;

  return (
    <fabric-file-browser className="fade-in" data-testid="hub-file-browser">
      <Segment>
        <Header as="h1" id="hub-downloads-heading" style={{ marginTop: 0 }}>
          {title}
        </Header>
        {description ? (
          <p style={{ color: '#666', maxWidth: '42rem', lineHeight: 1.45 }}>
            {description}
          </p>
        ) : null}
        <Breadcrumb>
          <Breadcrumb.Section
            as={Link}
            to={rootPath}
            active={!currentPath}
          >
            {title}
          </Breadcrumb.Section>
          {crumbs.map((c, i) => (
            <React.Fragment key={c.path}>
              <Breadcrumb.Divider icon="right angle" />
              {i === crumbs.length - 1 ? (
                <Breadcrumb.Section active>{c.name}</Breadcrumb.Section>
              ) : (
                <Breadcrumb.Section as={Link} to={hrefForRootRelative(rootPath, c.path)}>
                  {c.name}
                </Breadcrumb.Section>
              )}
            </React.Fragment>
          ))}
        </Breadcrumb>
      </Segment>

      {status === 'loading' ? (
        <Segment>
          <Loader active inline="centered" content="Loading listing…" />
        </Segment>
      ) : null}

      {status === 'error' ? (
        <Message negative>
          <Message.Header>Downloads listing unavailable</Message.Header>
          <p>{error || 'Could not load the downloads index.'}</p>
        </Message>
      ) : null}

      {status === 'ready' && exactFile ? (
        <Segment>
          <p>
            <Icon name="file outline" />
            {' '}
            <a href={hrefForRootRelative(rootPath, exactFile.path)}>
              {exactFile.path.split('/').pop()}
            </a>
            {exactFile.size != null ? ` · ${formatByteSize(exactFile.size)}` : ''}
          </p>
          {parentHref ? (
            <p>
              <Link to={parentHref}>Back to folder</Link>
            </p>
          ) : null}
        </Segment>
      ) : null}

      {status === 'ready' && !exactFile ? (
        <Segment>
          {entries.length === 0 ? (
            <Message info>
              <Message.Header>No files here yet</Message.Header>
              <p>
                Desktop installers land in <code>assets/downloads</code> after{' '}
                <code>npm run build:installers</code> (or <code>npm run build:desktop</code>).
                Refresh this page once that build finishes.
              </p>
            </Message>
          ) : (
            <Table compact unstackable data-testid="hub-file-browser-table">
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Name</Table.HeaderCell>
                  <Table.HeaderCell collapsing>Size</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {currentPath ? (
                  <Table.Row>
                    <Table.Cell colSpan={2}>
                      <Link to={parentHref || rootPath}>
                        <Icon name="level up" />
                        ..
                      </Link>
                    </Table.Cell>
                  </Table.Row>
                ) : null}
                {entries.map((entry) => {
                  const href = hrefForRootRelative(rootPath, entry.path);
                  if (entry.type === 'dir') {
                    return (
                      <Table.Row key={`dir:${entry.path}`} data-testid="hub-file-browser-entry">
                        <Table.Cell>
                          <Icon name="folder" />
                          <Link to={href}>{entry.name}</Link>
                        </Table.Cell>
                        <Table.Cell>—</Table.Cell>
                      </Table.Row>
                    );
                  }
                  return (
                    <Table.Row key={`file:${entry.path}`} data-testid="hub-file-browser-entry">
                      <Table.Cell>
                        <Icon name="file outline" />
                        <a href={href}>{entry.name}</a>
                      </Table.Cell>
                      <Table.Cell>{formatByteSize(entry.size)}</Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          )}
        </Segment>
      ) : null}
    </fabric-file-browser>
  );
}

module.exports = FileBrowser;
