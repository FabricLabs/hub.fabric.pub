'use strict';

/**
 * Hub list pagination — Semantic UI Pagination with pinned first/last jump buttons.
 * Adapted from sensemaker `components/CustomPagination.js`.
 */

const React = require('react');
const {
  Button,
  Icon,
  Pagination
} = require('semantic-ui-react');

class HubPagination extends React.Component {
  render () {
    const {
      activePage,
      totalPages,
      onPageChange,
      boundaryRange,
      siblingRange,
      showEllipsis,
      showPreviousAndNextNav = true,
      style = {},
      className = '',
      disabled = false
    } = this.props;

    if (totalPages <= 1) {
      return null;
    }

    const defaultBoundaryRange = boundaryRange !== undefined ? boundaryRange : (totalPages <= 10 ? totalPages : 2);
    const defaultSiblingRange = siblingRange !== undefined ? siblingRange : (totalPages <= 15 ? totalPages : 3);
    const defaultShowEllipsis = showEllipsis !== undefined ? showEllipsis : (totalPages > 15);
    const hidePrevNext = showPreviousAndNextNav === false;

    return (
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          ...style
        }}
        className={className}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Button
            icon
            disabled={disabled || activePage <= 1}
            onClick={(e) => onPageChange(e, { activePage: 1 })}
            style={{ marginRight: '0.5rem' }}
            title="Jump to first page"
            className="ui button"
            type="button"
          >
            <Icon name="angle double left" />
          </Button>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          flex: 1
        }}
        >
          <Pagination
            activePage={activePage}
            totalPages={totalPages}
            onPageChange={onPageChange}
            boundaryRange={defaultBoundaryRange}
            siblingRange={defaultSiblingRange}
            ellipsisItem={defaultShowEllipsis ? undefined : null}
            firstItem={null}
            lastItem={null}
            prevItem={(hidePrevNext || activePage === 1) ? null : undefined}
            nextItem={(hidePrevNext || activePage === totalPages) ? null : undefined}
            disabled={disabled}
            className="ui pagination menu"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Button
            icon
            disabled={disabled || activePage >= totalPages}
            onClick={(e) => onPageChange(e, { activePage: totalPages })}
            style={{ marginLeft: '0.5rem' }}
            title="Jump to last page"
            className="ui button"
            type="button"
          >
            <Icon name="angle double right" />
          </Button>
        </div>
      </div>
    );
  }
}

module.exports = HubPagination;
