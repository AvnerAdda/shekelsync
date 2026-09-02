const {
  MIGRATION_REVIEW_PATHS,
  isMigrationReviewPath,
  parseNameStatusRows,
} = require('../../../scripts/migrations/check_release_migrations.js');

describe('release migration checker', () => {
  it('reviews runtime, fresh-install, and one-off migration inputs', () => {
    expect(MIGRATION_REVIEW_PATHS).toEqual([
      'scripts/migrations',
      'app/lib/schema-migrations.js',
      'scripts/init_sqlite_db.js',
    ]);

    expect(isMigrationReviewPath('app/lib/schema-migrations.js')).toBe(true);
    expect(isMigrationReviewPath('scripts/init_sqlite_db.js')).toBe(true);
    expect(isMigrationReviewPath('scripts/migrations/add_feature.sql')).toBe(true);
    expect(isMigrationReviewPath('scripts/migrations/add_feature.js')).toBe(true);
    expect(isMigrationReviewPath('scripts/migrations/NEXT_RELEASE_CHECKLIST.md')).toBe(false);
    expect(isMigrationReviewPath('README.md')).toBe(false);
  });

  it('keeps all reviewed inputs in parsed git changes', () => {
    expect(parseNameStatusRows([
      'M\tapp/lib/schema-migrations.js',
      'M\tscripts/init_sqlite_db.js',
      'A\tscripts/migrations/add_feature.sql',
      'M\tREADME.md',
    ].join('\n'))).toEqual([
      {
        status: 'M',
        filePath: 'app/lib/schema-migrations.js',
        oldPath: null,
      },
      {
        status: 'M',
        filePath: 'scripts/init_sqlite_db.js',
        oldPath: null,
      },
      {
        status: 'A',
        filePath: 'scripts/migrations/add_feature.sql',
        oldPath: null,
      },
    ]);
  });
});
