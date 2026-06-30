# Implementation Plan: Stage 3.5 Task 1 - Prisma Schema Update

This plan outlines the steps to implement the Prisma schema updates for Stage 3.5 of the study app.

## Goal
Update the `prisma/schema.prisma` file to support categories, rich content blocks, assets, and quiz setup.

## Steps

1.  **Modify `prisma/schema.prisma`**:
    *   Add `CardCategory` and `CardCategoryAssignment` models.
    *   Add `CardContentBlock` and `CardAsset` models.
    *   Add fields to `QuizAttempt` to store quiz setup options.
2.  **Migration**:
    *   Run `npx prisma migrate dev --name stage3_5_rich_cards_categories_quiz_setup`.
    *   Run `npx prisma generate`.
3.  **Verification**:
    *   Run `npx tsc --noEmit` to ensure type safety.
4.  **Cleanup & Commit**:
    *   Commit changes.

## Backfilling Strategy
*   As part of the migration/post-migration, I will need a script to backfill `CardContentBlock` models from the existing `term` and `definition` fields on `Card` to ensure compatibility and rich content support for existing cards.

## Approval
I am ready to proceed with these changes upon approval.
