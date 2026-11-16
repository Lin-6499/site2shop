"""Partial checker tests; only the release wrapper may compose a validated baseline with a delta."""
import tempfile
import unittest
from pathlib import Path
from test_evidence_gates import Fixture
from validate_evidence_coverage import validate


class ScopedGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.f=Fixture(self.tmp.name)
        self.f.manifest['incremental']={'routeIds':['sample']}

    def run_scoped(self,ids=None,stage='online'):
        return validate(self.f.plan,self.f.manifest,Path(self.tmp.name),plan_sha256=self.f.digest,
                        stage=stage,build_id='build-A',theme_id='draft-A',route_ids=['sample'] if ids is None else ids)

    def test_scoped_comparisons_still_execute(self):
        self.assertEqual(self.run_scoped(),[])
        self.f.change(self.f.record()['target'],lambda d:d['observations'].update(fields=['wrong']))
        self.f.manifest['passed']=True
        self.assertTrue(self.run_scoped())

    def test_scope_is_exact_and_cannot_be_empty(self):
        self.assertTrue(self.run_scoped([]));self.assertTrue(self.run_scoped(['unplanned']))

    def test_scope_requires_explicit_partial_metadata(self):
        del self.f.manifest['incremental'];self.assertTrue(self.run_scoped())

    def test_scoped_source_gate_is_not_a_source_baseline(self):
        self.f.manifest['stage']='source';self.assertTrue(self.run_scoped(stage='source'))

    def test_omitted_required_state_is_not_excused_by_partial_scope(self):
        del self.f.manifest['routes']['sample']['viewports']['mobile']['states']['configured']
        self.assertTrue(self.run_scoped())

    def test_unreconciled_required_routes_block_even_old_green_delta(self):
        self.f.plan['requiredRouteExpansion']=self.f.save({'routes':[
            {'id':'sample','source':self.f.plan['routes']['sample']['source']['url'],
             'target':self.f.plan['routes']['sample']['target']['url'],
             'devices':['desktop','tablet','mobile']},
            {'id':'newly-discovered','source':'https://source.example/pages/missing',
             'target':'https://target.example/pages/missing',
             'devices':['desktop','tablet','mobile']}]})
        self.f.manifest['passed']=True
        self.assertTrue(self.run_scoped())
