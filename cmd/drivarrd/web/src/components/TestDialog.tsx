import React, { useRef, useEffect, useState } from 'react';
import { Device, Profile, Policy } from '../types';

interface TestDialogProps {
  device: Device;
  profiles: Profile[];
  policies: Policy[];
  initialProfileId?: string;
  onClose: () => void;
  onSubmit: (body: Record<string, string>) => Promise<void>;
}

export const TestDialog: React.FC<TestDialogProps> = ({
  device,
  profiles,
  policies,
  initialProfileId = 'preset:complete-drive-check',
  onClose,
  onSubmit,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const enabled = profiles.filter((p) => p.enabled);
  const [profileId, setProfileId] = useState(initialProfileId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialogRef.current?.showModal();
    return () => dialogRef.current?.close();
  }, []);

  const preset = profileId.startsWith('preset:');
  const destructive = profiles.find((p) => p.id === profileId)?.kind === 'destructive_verify';
  const probe = device.probe || {};

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    const submitter = (e.nativeEvent as any).submitter;
    if (submitter?.value === 'cancel') return;

    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const formData = new FormData(e.currentTarget);
      const body = Object.fromEntries(formData) as Record<string, string>;

      if (preset) {
        body.presetId = profileId.slice(7);
        delete body.profileId;
      }

      await onSubmit(body);
    } catch (err: any) {
      setError(err.message || 'Failed to start test');
    } finally {
      setLoading(false);
    }
  };

  return (
    <dialog ref={dialogRef} onClose={onClose}>
      <form method="dialog" onSubmit={handleSubmit}>
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">New test</p>
            <h2>{probe.model || device.name}</h2>
          </div>
          <button value="cancel" className="icon-button" aria-label="Close">
            ×
          </button>
        </div>

        <input name="deviceId" type="hidden" value={device.id} />

        <label>
          Test profile
          <select name="profileId" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <optgroup label="Presets">
              <option value="preset:complete-drive-check">
                Complete drive check · 3 ordered tests
              </option>
            </optgroup>
            <optgroup label="Individual tests">
              {enabled.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.builtIn ? '' : ' · advanced'}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        {preset && (
          <p className="supporting">
            Runs read speed and random IOPS, a full non-destructive error scan, then the drive firmware’s extended offline SMART self-test.
          </p>
        )}

        <label>
          Grading policy
          <select name="policyId">
            {policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.name} · v{policy.version}
              </option>
            ))}
          </select>
        </label>

        {destructive && (
          <div className="danger">
            <strong>This permanently erases the entire drive.</strong>
            <label>
              Type the drive serial to confirm
              <input name="serialConfirmation" required />
            </label>
            <label>
              Re-enter your password
              <input name="reauthPassword" type="password" autoComplete="current-password" required />
            </label>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="dialog-actions">
          <button value="cancel" className="text-button" type="button" onClick={onClose}>
            Cancel
          </button>

          <button value="default" className="filled" type="submit" disabled={loading}>
            {loading ? 'Submitting...' : preset ? 'Start preset' : 'Start test'}
          </button>
        </div>
      </form>
    </dialog>
  );
};
